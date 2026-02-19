import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { getGlobalConfig } from '../config/storage'
import { getStory } from '../fragments/storage'
import { MODEL_ROLES, roleSettingsKeys } from '@/lib/model-roles'
import type { LanguageModel } from 'ai'

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
 * Walks the role's fallback chain defined in MODEL_ROLES, then falls back to global default.
 */
export async function getModel(dataDir: string, storyId?: string, opts: GetModelOptions = {}): Promise<ResolvedModel> {
  const role = opts.role ?? 'generation'
  const roleConfig = MODEL_ROLES.find(r => r.key === role) ?? MODEL_ROLES[0]
  const chain = [role, ...roleConfig.fallback]

  // 1. Try to resolve from story settings by walking the fallback chain
  let targetProviderId: string | null = null
  let targetModelId: string | null = null

  if (storyId) {
    const story = await getStory(dataDir, storyId)
    if (story?.settings) {
      const settings = story.settings as Record<string, unknown>
      for (const r of chain) {
        const keys = roleSettingsKeys(r)
        const pid = settings[keys.providerId] as string | null | undefined
        if (pid) {
          targetProviderId = pid
          targetModelId = (settings[keys.modelId] as string | null | undefined) ?? null
          break
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
