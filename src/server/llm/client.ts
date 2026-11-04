import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGlobalConfig } from '../config/storage'
import { getStory } from '../fragments/storage'
import { modelRoleRegistry } from '../agents/model-role-registry'
import { ensureCoreAgentsRegistered } from '../agents/register-core'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import type { LanguageModel, streamText } from 'ai'
import { createLogger } from '../logging'
import { isGeminiProvider, normalizeGeminiBaseURL, geminiThinkingConfig } from './gemini'

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
const googleProviderCache = new Map<string, ReturnType<typeof createGoogleGenerativeAI>>()

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

function getCachedGoogleProvider(
  id: string,
  baseURL: string,
  apiKey: string,
  customHeaders?: Record<string, string>,
) {
  const headerStr = customHeaders ? JSON.stringify(customHeaders) : ''
  const cacheKey = `${id}:${baseURL}:${apiKey}:${headerStr}`
  let provider = googleProviderCache.get(cacheKey)
  if (!provider) {
    provider = createGoogleGenerativeAI({
      apiKey,
      baseURL,
      headers: customHeaders && Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    })
    googleProviderCache.set(cacheKey, provider)
  }
  return provider
}

/** Provider-specific options as accepted by `streamText` / `generateText` / `ToolLoopAgent`. */
export type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>

/** Which SDK provider a resolved model runs through. */
export type ResolvedModelKind = 'gemini' | 'openai-compatible'

/**
 * Build providerOptions controlling extended thinking / reasoning for the
 * resolved model.
 *
 * - OpenAI-compatible endpoints: `reasoningEffort: 'none'` when thinking is
 *   disabled, nothing otherwise.
 * - Native Gemini: the lowest thinking setting the model family accepts when
 *   disabled (families differ, see `gemini.ts`); otherwise ask for thought
 *   summaries so reasoning streams into the UI.
 *
 * Without a resolved model (legacy callers) the OpenAI-compatible behaviour is
 * assumed.
 */
export function buildProviderOptions(
  disableThinking: boolean,
  resolved?: { kind: ResolvedModelKind; modelId: string },
): ProviderOptions | undefined {
  if (resolved?.kind === 'gemini') {
    return { google: { thinkingConfig: geminiThinkingConfig(resolved.modelId, { disableThinking }) } }
  }
  if (!disableThinking) return undefined
  return { openaiCompatible: { reasoningEffort: 'none' } }
}

export interface ResolvedModel {
  model: LanguageModel
  kind: ResolvedModelKind
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
        if (!targetModelId && override?.modelId) {
          targetModelId = override.modelId
        }
        if (override?.providerId) {
          targetProviderId = override.providerId
          targetModelId = targetModelId || override.modelId || null
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

  // 3. Build the candidate list in priority order: the story's configured
  //    provider, then the global default. This way a story that points at a
  //    now-disabled or deleted provider falls back to the default instead of
  //    hard-failing with "No provider configured".
  const candidateIds: string[] = []
  if (targetProviderId) candidateIds.push(targetProviderId)
  if (globalConfig.defaultProviderId && globalConfig.defaultProviderId !== targetProviderId) {
    candidateIds.push(globalConfig.defaultProviderId)
  }

  // 4. Use the first candidate that exists and is enabled.
  for (const candidateId of candidateIds) {
    const provider = globalConfig.providers.find((p) => p.id === candidateId && p.enabled)
    if (!provider) continue

    // When the story explicitly chose a provider that turned out unusable and we
    // fell through to the default, its stored modelId belongs to the old provider
    // — use the fallback provider's default model instead.
    const usingFallback = targetProviderId != null && candidateId !== targetProviderId
    const modelId = (usingFallback ? null : targetModelId) || provider.defaultModel
    const nativeGemini = isGeminiProvider(provider)
    const baseURL = nativeGemini ? normalizeGeminiBaseURL(provider.baseURL) : provider.baseURL
    // Locally-hosted thinking models (Qwen-style) behind plain OpenAI-compatible
    // endpoints emit `<think>...</think>` inside ordinary text deltas. Extract
    // those into proper reasoning parts so they never leak into saved prose or
    // JSON parsing. Native Gemini already separates reasoning server-side.
    const model = nativeGemini
      ? getCachedGoogleProvider(provider.id, baseURL, provider.apiKey, provider.customHeaders)(modelId)
      : wrapLanguageModel({
          model: getCachedProvider(provider.id, provider.baseURL, provider.apiKey, provider.name, provider.customHeaders).chatModel(modelId),
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        })
    // Story-level temperature takes precedence over provider-level
    const temperature = targetTemperature ?? provider.temperature
    const toReturn: ResolvedModel = {
      model,
      kind: nativeGemini ? 'gemini' : 'openai-compatible',
      providerId: provider.id,
      modelId,
      temperature,
      config: {
        providerName: provider.name,
        baseURL,
        headers: { ...(provider.customHeaders ?? {}) },
      },
    }
    createLogger("models").debug('Resolved model', {...toReturn, model: "[hidden]"}) // Don't log the full model object to avoid spam
    return toReturn
  }

  // 5. No provider found — throw descriptive error
  throw new Error('No LLM provider configured. Add a provider in Settings > Providers.')
}
