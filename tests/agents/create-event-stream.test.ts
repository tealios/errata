import { describe, it, expect } from 'vitest'
import { createEventStream } from '@/server/agents/create-event-stream'

async function* parts(events: Array<Record<string, unknown>>) {
  for (const event of events) yield event
}

async function collect(stream: ReadableStream<string>) {
  const reader = stream.getReader()
  const lines: Array<Record<string, unknown>> = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    for (const line of value.split('\n')) {
      if (line.trim()) lines.push(JSON.parse(line))
    }
  }
  return lines
}

describe('createEventStream', () => {
  it('forwards tool-error parts so clients learn a tool call failed', async () => {
    const { eventStream, completion } = createEventStream(parts([
      { type: 'tool-call', toolCallId: 'c1', toolName: 'updateStorySetup', input: { fragments: [] } },
      { type: 'tool-error', toolCallId: 'c1', toolName: 'updateStorySetup', input: { fragments: [] }, error: 'Invalid input: too big' },
      { type: 'text-delta', text: 'Done.' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]))

    const events = await collect(eventStream)
    expect(events).toContainEqual({
      type: 'tool-error',
      id: 'c1',
      toolName: 'updateStorySetup',
      args: { fragments: [] },
      error: 'Invalid input: too big',
    })

    const result = await completion
    expect(result.toolCalls).toEqual([
      { toolName: 'updateStorySetup', args: { fragments: [] }, result: undefined, error: 'Invalid input: too big' },
    ])
  })

  it('stringifies Error objects carried by tool-error parts', async () => {
    const { eventStream } = createEventStream(parts([
      { type: 'tool-call', toolCallId: 'c1', toolName: 'createFragment', input: {} },
      { type: 'tool-error', toolCallId: 'c1', toolName: 'createFragment', input: {}, error: new Error('disk full') },
      { type: 'finish', finishReason: 'stop' },
    ]))

    const events = await collect(eventStream)
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool-error', error: 'disk full' }))
  })

  it('forwards stream-level error parts instead of swallowing them', async () => {
    const { eventStream, completion } = createEventStream(parts([
      { type: 'error', error: new Error('provider exploded') },
      { type: 'finish', finishReason: 'error' },
    ]))

    const events = await collect(eventStream)
    expect(events).toContainEqual({ type: 'error', error: 'provider exploded' })
    const result = await completion
    expect(result.error).toBe('provider exploded')
  })

  it('still records successful tool results without an error field', async () => {
    const { completion, eventStream } = createEventStream(parts([
      { type: 'tool-call', toolCallId: 'c1', toolName: 'createFragment', input: { name: 'A' } },
      { type: 'tool-result', toolCallId: 'c1', toolName: 'createFragment', output: { ok: true, id: 'ch-a' } },
      { type: 'finish', finishReason: 'stop' },
    ]))
    await collect(eventStream)
    const result = await completion
    expect(result.toolCalls).toEqual([{ toolName: 'createFragment', args: { name: 'A' }, result: { ok: true, id: 'ch-a' } }])
    expect(result.error).toBeUndefined()
  })
})
