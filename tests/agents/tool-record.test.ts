import { describe, expect, it } from 'vitest'
import {
  compactToolCallRecord,
  formatToolActivity,
  toModelMessages,
  ChatTranscriptMessageSchema,
} from '@/server/agents/tool-record'

describe('tool activity records in chat transcripts', () => {
  it('summarises successful and failed calls for the model', () => {
    const text = formatToolActivity([
      { toolName: 'createFragment', args: { name: 'Mara' }, result: { ok: true, id: 'ch-mara' } },
      { toolName: 'updateStorySetup', args: {}, error: 'Invalid input: description too long' },
    ])
    expect(text).toContain('createFragment')
    expect(text).toContain('ch-mara')
    expect(text).toMatch(/updateStorySetup.*failed.*description too long/)
  })

  it('appends the activity to assistant messages only, leaving user text untouched', () => {
    const messages = toModelMessages([
      { role: 'user', content: 'Add Mara.' },
      { role: 'assistant', content: 'Added Mara.', toolCalls: [{ toolName: 'createFragment', result: { ok: true, id: 'ch-mara' } }] },
      { role: 'user', content: 'Thanks', toolCalls: [{ toolName: 'ignored' }] },
      { role: 'assistant', content: 'Plain reply.' },
    ])
    expect(messages[0]).toEqual({ role: 'user', content: 'Add Mara.' })
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content.startsWith('Added Mara.')).toBe(true)
    expect(messages[1].content).toContain('ch-mara')
    expect(messages[2]).toEqual({ role: 'user', content: 'Thanks' })
    expect(messages[3]).toEqual({ role: 'assistant', content: 'Plain reply.' })
  })

  it('marks a turn that made no tool calls while claiming nothing extra', () => {
    const [msg] = toModelMessages([{ role: 'assistant', content: 'Done!', toolCalls: [] }])
    expect(msg.content).toMatch(/no tools were called/i)
  })

  it('compacts bulky results and args before they are stored', () => {
    const record = compactToolCallRecord({
      toolName: 'getFragment',
      args: { id: 'pr-1', note: 'x'.repeat(500) },
      result: { content: 'y'.repeat(5000) },
    })
    expect(JSON.stringify(record).length).toBeLessThan(1200)
    expect(record.toolName).toBe('getFragment')
    expect(record.error).toBeUndefined()
  })

  it('accepts transcript messages with or without tool activity', () => {
    expect(ChatTranscriptMessageSchema.safeParse({ role: 'user', content: 'hi' }).success).toBe(true)
    expect(ChatTranscriptMessageSchema.safeParse({
      role: 'assistant',
      content: 'ok',
      toolCalls: [{ toolName: 'createFragment', args: { a: 1 }, result: { ok: true } }],
    }).success).toBe(true)
  })
})
