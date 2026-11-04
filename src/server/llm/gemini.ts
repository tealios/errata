/**
 * Shared helpers for Google's native Gemini API (generativelanguage.googleapis.com).
 *
 * Gemini model families disagree about how thinking is controlled, so anything
 * that talks to Gemini (model resolution, provider options, the connection test
 * in Settings) goes through here instead of guessing per call site.
 */

export function isGeminiProvider(provider: { preset?: string; baseURL: string }): boolean {
  return provider.preset === 'gemini' || provider.baseURL.includes('generativelanguage.googleapis.com')
}

/** Strip trailing slashes and the OpenAI-compat `/openai` suffix so the native API is used. */
export function normalizeGeminiBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/openai$/, '')
}

export interface GeminiVersion {
  major: number
  minor: number
}

/**
 * Parse the model generation out of an id like `gemini-3.8-flash`, `gemini-4-argon`
 * or `models/gemini-2.5-pro`. Returns null for aliases (`gemini-flash-latest`)
 * and anything that isn't a Gemini model.
 */
export function parseGeminiVersion(modelId: string): GeminiVersion | null {
  const match = /^(?:models\/)?gemini-(\d+)(?:\.(\d+))?(?:-|$)/.exec(modelId.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: match[2] ? Number(match[2]) : 0 }
}

export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

export type GeminiThinkingConfig = {
  thinkingLevel?: GeminiThinkingLevel
  thinkingBudget?: number
  includeThoughts?: boolean
}

/**
 * Lowest thinking setting a model family accepts. Verified against the live API:
 * - Gemini 2.x: `thinkingLevel` is rejected (400); `thinkingBudget: 0` disables thinking.
 * - Gemini 3.0–3.7: `thinkingLevel: 'minimal'` disables thinking.
 * - Gemini 3.8+ and 4.x: `minimal` is rejected (400 "Thinking level MINIMAL is not
 *   supported"), `thinkingBudget` is silently ignored, and `low` is the floor.
 * - Unknown ids / `-latest` aliases: `thinkingBudget: 0`, which every family at
 *   least tolerates.
 */
export function minimalGeminiThinking(modelId: string): GeminiThinkingConfig {
  const version = parseGeminiVersion(modelId)
  if (!version) return { thinkingBudget: 0 }
  if (version.major >= 4 || (version.major === 3 && version.minor >= 8)) return { thinkingLevel: 'low' }
  if (version.major === 3) return { thinkingLevel: 'minimal' }
  return { thinkingBudget: 0 }
}

/**
 * Thinking config for a story's "disable thinking" preference. When thinking stays
 * on we ask for thought summaries so reasoning streams into the UI like it does
 * for OpenAI-compatible reasoning models.
 */
export function geminiThinkingConfig(modelId: string, opts: { disableThinking: boolean }): GeminiThinkingConfig {
  if (opts.disableThinking) return minimalGeminiThinking(modelId)
  return { includeThoughts: true }
}

/**
 * Models that make sense in a prose-writing model picker. The `/models` listing
 * reports `generateContent` for TTS, transcription, image and agent endpoints
 * that cannot hold a text conversation; keep those out of the dropdown.
 */
const NON_CHAT_MODEL_PATTERN = /(^|-)(tts|transcribe|image|embedding|live|robotics|native-audio|computer-use|nano-banana|aqa|imagen|veo|lyria|antigravity)(-|$)/i

export function isGeminiChatModel(modelId: string): boolean {
  const id = modelId.replace(/^models\//, '')
  return !NON_CHAT_MODEL_PATTERN.test(id)
}
