import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { getGlobalConfig } from '../config/storage'
import { getStory } from '../fragments/storage'
import { modelRoleRegistry } from '../agents/model-role-registry'
import { ensureCoreAgentsRegistered } from '../agents/register-core'
import type { LanguageModel } from 'ai'
import { createLogger } from '../logging'

// Normalize old camelCase modelOverrides keys to dot-separated agent names
const OVERRIDE_KEY_ALIASES: Record<string, string> = {
  characterChat: 'character-chat.chat',
  librarianChat: 'librarian.chat',
  librarianRefine: 'librarian.refine',
  proseTransform: 'librarian.prose-transform',
  prewriter: 'generation.prewriter',
}

/** Apply key aliases to a modelOverrides map, returning a normalized copy */
function normalizeOverrideKeys(
  overrides: Record<string, { providerId?: string | null; modelId?: string | null; temperature?: number | null }>,
): Record<string, { providerId?: string | null; modelId?: string | null; temperature?: number | null }> {
  const result: Record<string, { providerId?: string | null; modelId?: string | null; temperature?: number | null }> = {}
  for (const [key, value] of Object.entries(overrides)) {
    const normalizedKey = OVERRIDE_KEY_ALIASES[key] ?? key
    // Don't overwrite if the new key already exists (new-style key takes priority)
    if (!(normalizedKey in result)) {
      result[normalizedKey] = value
    }
  }
  return result
}

// Legacy field name mapping for backward compat with old story JSON files
const LEGACY_FIELD_MAP: Record<string, { providerId: string; modelId: string }> = {
  generation: { providerId: 'providerId', modelId: 'modelId' },
  librarian: { providerId: 'librarianProviderId', modelId: 'librarianModelId' },
  'character-chat': { providerId: 'characterChatProviderId', modelId: 'characterChatModelId' },
  'librarian.prose-transform': { providerId: 'proseTransformProviderId', modelId: 'proseTransformModelId' },
  'librarian.chat': { providerId: 'librarianChatProviderId', modelId: 'librarianChatModelId' },
  'librarian.refine': { providerId: 'librarianRefineProviderId', modelId: 'librarianRefineModelId' },
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
      includeUsage: true,
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
  temperature?: number
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
  let targetTemperature: number | undefined = undefined

  if (storyId) {
    const story = await getStory(dataDir, storyId)
    if (story?.settings) {
      const overrides = normalizeOverrideKeys(story.settings.modelOverrides ?? {})
      const settings = story.settings as Record<string, unknown>

      for (const r of chain) {
        // Check modelOverrides map first
        const override = overrides[r]
        if (override?.providerId) {
          targetProviderId = override.providerId
          targetModelId = override.modelId ?? null
          if (override.temperature != null) {
            targetTemperature = override.temperature
          }
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

      // If no temperature from the matched role override, check if any role in chain has temperature set
      if (targetTemperature === undefined) {
        for (const r of chain) {
          const override = overrides[r]
          if (override?.temperature != null) {
            targetTemperature = override.temperature
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
      // Story-level temperature takes precedence over provider-level
      const temperature = targetTemperature ?? provider.temperature
      const toReturn = {
        model: oai.chatModel(modelId),
        providerId: provider.id,
        modelId,
        temperature,
        config: {
          providerName: provider.name,
          baseURL: provider.baseURL,
          headers: { ...(provider.customHeaders ?? {}) },
        },
      }
      createLogger("models").debug('Resolved model', {...toReturn, model: "[hidden]"}) // Don't log the full model object to avoid spam
      return toReturn
    }
  }

  // 5. No provider found — throw descriptive error
  throw new Error('No LLM provider configured. Add a provider in Settings > Providers.')
}
