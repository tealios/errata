/**
 * Tool activity records for text-only chat transcripts.
 *
 * Chat agents replay history to the model as plain `{ role, content }` messages,
 * so the model never sees which of its earlier replies were backed by real tool
 * calls. After a tool failure it tends to imitate its own "I have added that"
 * messages without calling anything. Recording what actually happened next to
 * each assistant turn, and replaying that record, keeps the transcript honest.
 */

import { z } from 'zod/v4'

export const ChatToolCallRecordSchema = z.object({
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
})

export const ChatTranscriptMessageSchema = z.object({
  role: z.union([z.literal('user'), z.literal('assistant')]),
  content: z.string(),
  toolCalls: z.array(ChatToolCallRecordSchema).optional(),
})

export type ChatToolCallRecord = z.infer<typeof ChatToolCallRecordSchema>
export type ChatTranscriptMessage = z.infer<typeof ChatTranscriptMessageSchema>

const ARG_STRING_MAX = 120
const RESULT_JSON_MAX = 400

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}... [${text.length - max} more chars]`
}

function compactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncate(value, ARG_STRING_MAX)
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map(v => compactValue(v, depth + 1))
    return value.length > 20 ? [...items, `... ${value.length - 20} more`] : items
  }
  if (value && typeof value === 'object') {
    if (depth >= 3) return '[object]'
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, compactValue(v, depth + 1)]),
    )
  }
  return value
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Shrink a record enough to live in persisted history and replayed prompts. */
export function compactToolCallRecord(record: ChatToolCallRecord): ChatToolCallRecord {
  const compact: ChatToolCallRecord = { toolName: record.toolName }
  if (record.args && Object.keys(record.args).length > 0) {
    compact.args = compactValue(record.args) as Record<string, unknown>
  }
  if (record.error !== undefined) {
    compact.error = truncate(record.error, RESULT_JSON_MAX)
  } else if (record.result !== undefined) {
    const json = safeJson(record.result)
    compact.result = json.length <= RESULT_JSON_MAX ? record.result : truncate(json, RESULT_JSON_MAX)
  }
  return compact
}

function describeResult(result: unknown): string {
  if (result === undefined) return 'ok'
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as Record<string, unknown>
    if (typeof r.error === 'string') return `failed: ${truncate(r.error, RESULT_JSON_MAX)}`
    const bits: string[] = []
    if (typeof r.id === 'string') bits.push(`id ${r.id}`)
    if (Array.isArray(r.fragments)) bits.push(`${r.fragments.length} fragments saved`)
    if (bits.length > 0) return `ok (${bits.join(', ')})`
  }
  return `ok: ${truncate(safeJson(result), RESULT_JSON_MAX)}`
}

function describeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return ''
  const named = ['fragmentId', 'id', 'name', 'type', 'key']
    .filter(k => typeof args[k] === 'string')
    .map(k => `${k}=${truncate(args[k] as string, 60)}`)
  return named.length > 0 ? `(${named.join(', ')})` : ''
}

/**
 * One-line-per-call account of what the tools really did in a turn. Returned as
 * a bracketed note so it reads as a system annotation, not as the assistant's prose.
 */
export function formatToolActivity(toolCalls: ChatToolCallRecord[]): string {
  if (toolCalls.length === 0) {
    return '[Tool activity this turn: none. No tools were called, so nothing was created, edited, or saved.]'
  }
  const lines = toolCalls.map(call => {
    const status = call.error !== undefined
      ? `failed: ${truncate(call.error, RESULT_JSON_MAX)}`
      : describeResult(call.result)
    return `- ${call.toolName}${describeArgs(call.args)}: ${status}`
  })
  return `[Tool activity this turn:\n${lines.join('\n')}]`
}

/**
 * Convert a stored transcript into the plain messages handed to the model.
 * Assistant turns that carry a tool record get the record appended; user turns
 * pass through unchanged (any stray record on them is dropped).
 */
export function toModelMessages(
  messages: ChatTranscriptMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages.map(message => {
    if (message.role !== 'assistant' || message.toolCalls === undefined) {
      return { role: message.role, content: message.content }
    }
    const activity = formatToolActivity(message.toolCalls)
    return {
      role: 'assistant',
      content: message.content.trim() ? `${message.content}\n\n${activity}` : activity,
    }
  })
}
