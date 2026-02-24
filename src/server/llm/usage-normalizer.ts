import type { TokenUsage } from './generation-logs'

function toNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
}

function readFirstNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const parsed = toNumber(obj[key])
    if (typeof parsed === 'number') return parsed
  }
  return undefined
}

/**
 * Normalizes token usage across providers/SDKs.
 * Supports:
 * - AI SDK style: { inputTokens, outputTokens }
 * - OpenAI-style camelCase: { promptTokens, completionTokens }
 * - OpenAI-style snake_case: { prompt_tokens, completion_tokens }
 * - Nested OpenAI response: { usage: { ... } }
 */
export function normalizeTokenUsage(rawUsage: unknown): TokenUsage | undefined {
  if (!rawUsage || typeof rawUsage !== 'object') return undefined

  const top = rawUsage as Record<string, unknown>
  const nestedUsage = top.usage && typeof top.usage === 'object'
    ? (top.usage as Record<string, unknown>)
    : null

  const inputTokens =
    readFirstNumber(top, ['inputTokens', 'promptTokens', 'prompt_tokens', 'input_tokens']) ??
    (nestedUsage ? readFirstNumber(nestedUsage, ['inputTokens', 'promptTokens', 'prompt_tokens', 'input_tokens']) : undefined)

  const outputTokens =
    readFirstNumber(top, ['outputTokens', 'completionTokens', 'completion_tokens', 'output_tokens']) ??
    (nestedUsage ? readFirstNumber(nestedUsage, ['outputTokens', 'completionTokens', 'completion_tokens', 'output_tokens']) : undefined)

  if (typeof inputTokens !== 'number' && typeof outputTokens !== 'number') return undefined

  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  }
}
