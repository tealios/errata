import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { getGlobalConfig } from '../config/storage'
import { getStory } from '../fragments/storage'
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
  role?: 'generation' | 'librarian' | 'character-chat'
}

/**
 * Resolve the model to use for a given story.
 * Resolution chain: story.settings.providerId -> globalConfig.defaultProviderId -> error
 */
export async function getModel(dataDir: string, storyId?: string, opts: GetModelOptions = {}): Promise<ResolvedModel> {
  const role = opts.role ?? 'generation'
  // 1. Try to resolve from story settings
  let targetProviderId: string | null = null
  let targetModelId: string | null = null

  if (storyId) {
    const story = await getStory(dataDir, storyId)
    if (story?.settings) {
      if (role === 'librarian') {
        targetProviderId = story.settings.librarianProviderId ?? story.settings.providerId ?? null
        targetModelId = story.settings.librarianModelId ?? story.settings.modelId ?? null
      } else if (role === 'character-chat') {
        targetProviderId = story.settings.characterChatProviderId ?? story.settings.providerId ?? null
        targetModelId = story.settings.characterChatModelId ?? story.settings.modelId ?? null
      } else {
        targetProviderId = story.settings.providerId ?? null
        targetModelId = story.settings.modelId ?? null
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
