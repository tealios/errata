import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { getGlobalConfig } from '../config/storage'
import { getStory } from '../fragments/storage'
import { modelRoleRegistry } from '../agents/model-role-registry'
import { ensureCoreAgentsRegistered } from '../agents/register-core'
import type { LanguageModel } from 'ai'

// Legacy field name mapping for backward compat with old story JSON files
const LEGACY_FIELD_MAP: Record<string, { providerId: string; modelId: string }> = {
  generation: { providerId: 'providerId', modelId: 'modelId' },
  librarian: { providerId: 'librarianProviderId', modelId: 'librarianModelId' },
  characterChat: { providerId: 'characterChatProviderId', modelId: 'characterChatModelId' },
  proseTransform: { providerId: 'proseTransformProviderId', modelId: 'proseTransformModelId' },
  librarianChat: { providerId: 'librarianChatProviderId', modelId: 'librarianChatModelId' },
  librarianRefine: { providerId: 'librarianRefineProviderId', modelId: 'librarianRefineModelId' },
  directions: { providerId: 'directionsProviderId', modelId: 'directionsModelId' },
}

// Provider cache: keyed by `id:baseURL:apiKey`
const providerCache = new Map<string, ReturnType<typeof createOpenAICompatible>>()

function getCachedProvider(id: string, baseURL: string, apiKey: string, name: string, customHeaders?: Record<string, string>) {
  const headerStr = customHeaders ? JSON.stringify(customHeaders) : ''
  const cacheKey = `${id}:${baseURL}:${apiKey}:${headerStr}`
  let provider = providerCache.get(cacheKey)
  if (!provider) {
    provider = createOpenAICompatible({
      name,
      baseURL,
      apiKey,
      headers: customHeaders && Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    })
    providerCache.set(cacheKey, provider)
  }
  return provider
}

export interface ResolvedModel {
  model: LanguageModel
  providerId: string | null
  modelId: string
  config: {
    providerName: string | null
    baseURL: string | null
    headers: Record<string, string>
  }
}

export interface GetModelOptions {
  role?: string
}

/**
 * Resolve the model to use for a given story.
 * Checks modelOverrides map first, then legacy fields, walking the role's fallback chain.
 */
export async function getModel(dataDir: string, storyId?: string, opts: GetModelOptions = {}): Promise<ResolvedModel> {
  ensureCoreAgentsRegistered()

  const role = opts.role ?? 'generation'
  const chain = modelRoleRegistry.getFallbackChain(role)

  // 1. Try to resolve from story settings by walking the fallback chain
  let targetProviderId: string | null = null
  let targetModelId: string | null = null

  if (storyId) {
    const story = await getStory(dataDir, storyId)
    if (story?.settings) {
      const overrides = story.settings.modelOverrides ?? {}
      const settings = story.settings as Record<string, unknown>

      for (const r of chain) {
        // Check modelOverrides map first
        const override = overrides[r]
        if (override?.providerId) {
          targetProviderId = override.providerId
          targetModelId = override.modelId ?? null
          break
        }
        // Fall back to legacy fields
        const legacy = LEGACY_FIELD_MAP[r]
        if (legacy) {
          const pid = settings[legacy.providerId] as string | null | undefined
          if (pid) {
            targetProviderId = pid
            targetModelId = (settings[legacy.modelId] as string | null | undefined) ?? null
            break
          }
        }
      }
    }
  }

  // 2. Load global config
  const globalConfig = await getGlobalConfig(dataDir)

  // 3. Fall back to global default provider if story didn't specify one
  if (!targetProviderId && globalConfig.defaultProviderId) {
    targetProviderId = globalConfig.defaultProviderId
  }

  // 4. Try to find the provider in config
  if (targetProviderId) {
    const provider = globalConfig.providers.find((p) => p.id === targetProviderId && p.enabled)
    if (provider) {
      const oai = getCachedProvider(provider.id, provider.baseURL, provider.apiKey, provider.name, provider.customHeaders)
      const modelId = targetModelId || provider.defaultModel
      return {
        model: oai.chatModel(modelId),
        providerId: provider.id,
        modelId,
        config: {
          providerName: provider.name,
          baseURL: provider.baseURL,
          headers: { ...(provider.customHeaders ?? {}) },
        },
      }
    }
  }

  // 5. No provider found — throw descriptive error
  throw new Error('No LLM provider configured. Add a provider in Settings > Providers.')
}
