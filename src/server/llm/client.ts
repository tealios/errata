import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { getGlobalConfig } from '../config/storage'
import { getStory } from '../fragments/storage'
import type { LanguageModel } from 'ai'

// Backward-compatible default model using DeepSeek env var
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? 'sk-2106322f663f4d68a89c1386cb8f0ba5',
})
export const defaultModel = deepseek('deepseek-chat')

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

/**
 * Resolve the model to use for a given story.
 * Resolution chain: story.settings.providerId -> globalConfig.defaultProviderId -> env-var DeepSeek fallback
 */
export async function getModel(dataDir: string, storyId?: string): Promise<ResolvedModel> {
  // 1. Try to resolve from story settings
  let targetProviderId: string | null = null
  let targetModelId: string | null = null

  if (storyId) {
    const story = await getStory(dataDir, storyId)
    if (story?.settings) {
      targetProviderId = story.settings.providerId ?? null
      targetModelId = story.settings.modelId ?? null
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

  // 5. Env-var DeepSeek fallback
  return {
    model: defaultModel,
    providerId: null,
    modelId: 'deepseek-chat',
    config: {
      providerName: 'DeepSeek',
      baseURL: 'https://api.deepseek.com',
      headers: {},
    },
  }
}
