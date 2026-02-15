import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir } from '../setup'
import {
  createStory,
  createFragment,
} from '@/server/fragments/storage'
import { initProseChain } from '@/server/fragments/prose-chain'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

// Mock the AI SDK streamText
vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    streamText: vi.fn(),
  }
})

import { streamText } from 'ai'
import { createApp } from '@/server/api'

const mockedStreamText = vi.mocked(streamText)

function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    summary: 'A hero enters a forest.',
    createdAt: now,
    updatedAt: now,
    settings: {
      outputFormat: 'markdown',
      enabledPlugins: [],
      summarizationThreshold: 4,
      maxSteps: 10,
      providerId: null,
      modelId: null,
      contextOrderMode: 'simple' as const,
      fragmentOrder: [],
    },
    ...overrides,
  }
}

function makeFragment(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'ch-0001',
    type: 'character',
    name: 'Alice',
    description: 'The protagonist',
    content: 'Alice is a brave warrior with blue eyes.',
    tags: [],
    refs: [],
    sticky: true,
    placement: 'user' as const,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    ...overrides,
  }
}

// Helper: create a fullStream-compatible async iterable from an array of parts
function createFullStream(parts: Array<Record<string, unknown>>) {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part)
      }
      controller.close()
    },
  })
}

function createMockStreamResult(text: string, options?: {
  toolCalls?: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>
  toolResults?: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown>; result: unknown }>
  reasoning?: string
}) {
  // Build fullStream parts
  const parts: Array<Record<string, unknown>> = []

  if (options?.reasoning) {
    parts.push({ type: 'reasoning-delta', text: options.reasoning })
  }

  if (options?.toolCalls) {
    for (const tc of options.toolCalls) {
      parts.push({ type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.args })
    }
  }

  if (options?.toolResults) {
    for (const tr of options.toolResults) {
      parts.push({ type: 'tool-result', toolCallId: tr.toolCallId, toolName: tr.toolName, output: tr.result })
    }
  }

  // Text deltas
  if (text) {
    parts.push({ type: 'text-delta', text })
  }

  // Finish event
  parts.push({ type: 'finish', finishReason: 'stop' })

  const fullStream = createFullStream(parts)

  // Also provide textStream for backward compat (used by tee pattern if needed)
  const textStream = new ReadableStream<string>({
    start(controller) {
      if (text) controller.enqueue(text)
      controller.close()
    },
  })

  return {
    textStream,
    fullStream,
    text: Promise.resolve(text),
    usage: Promise.resolve({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }),
    finishReason: Promise.resolve('stop' as const),
    steps: Promise.resolve([]),
    toTextStreamResponse: () => new Response(text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
  }
}

// Parse NDJSON response body into an array of events
async function parseNdjson(res: Response): Promise<Array<Record<string, unknown>>> {
  const body = await res.text()
  return body
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

describe('librarian chat endpoint', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>
  const storyId = 'story-test'

  async function api(path: string, init?: RequestInit) {
    return app.fetch(new Request(`http://localhost/api${path}`, init))
  }

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    app = createApp(dataDir)
    await createStory(dataDir, makeStory())
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await cleanup()
  })

  it('returns 404 when story does not exist', async () => {
    const res = await api('/stories/nonexistent/librarian/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('Story not found')
  })

  it('returns 422 when messages array is empty', async () => {
    const res = await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('message')
  })

  it('streams NDJSON events for a text-only response', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('Here are the characters in your story...') as any,
    )

    const res = await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'List all characters' }],
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson; charset=utf-8')

    const events = await parseNdjson(res)

    // Should have text event(s) and a finish event
    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents.length).toBeGreaterThan(0)
    expect(textEvents[0].text).toContain('characters')

    const finishEvents = events.filter((e) => e.type === 'finish')
    expect(finishEvents).toHaveLength(1)
    expect(finishEvents[0].finishReason).toBe('stop')
  })

  it('streams tool-call and tool-result events', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('I updated the character.', {
        toolCalls: [
          { toolCallId: 'tc_1', toolName: 'editFragment', args: { fragmentId: 'ch-0001', oldText: 'blue eyes', newText: 'green eyes' } },
        ],
        toolResults: [
          { toolCallId: 'tc_1', toolName: 'editFragment', args: { fragmentId: 'ch-0001', oldText: 'blue eyes', newText: 'green eyes' }, result: { ok: true } },
        ],
      }) as any,
    )

    const res = await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Change Alice eyes to green' }],
      }),
    })

    expect(res.status).toBe(200)
    const events = await parseNdjson(res)

    const toolCallEvents = events.filter((e) => e.type === 'tool-call')
    expect(toolCallEvents).toHaveLength(1)
    expect(toolCallEvents[0].toolName).toBe('editFragment')
    expect(toolCallEvents[0].id).toBe('tc_1')
    expect(toolCallEvents[0].args).toEqual({ fragmentId: 'ch-0001', oldText: 'blue eyes', newText: 'green eyes' })

    const toolResultEvents = events.filter((e) => e.type === 'tool-result')
    expect(toolResultEvents).toHaveLength(1)
    expect(toolResultEvents[0].toolName).toBe('editFragment')
    expect(toolResultEvents[0].result).toEqual({ ok: true })
  })

  it('streams reasoning events', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('Done.', {
        reasoning: 'Let me find the character fragment first...',
      }) as any,
    )

    const res = await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Update Alice' }],
      }),
    })

    expect(res.status).toBe(200)
    const events = await parseNdjson(res)

    const reasoningEvents = events.filter((e) => e.type === 'reasoning')
    expect(reasoningEvents).toHaveLength(1)
    expect(reasoningEvents[0].text).toContain('find the character')
  })

  it('passes write-enabled tools to streamText', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('Done.') as any,
    )

    await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Update Alice' }],
      }),
    })

    expect(mockedStreamText).toHaveBeenCalledTimes(1)
    const callArgs = mockedStreamText.mock.calls[0][0] as any

    // Should have write tools (not read-only)
    expect(callArgs.tools).toBeDefined()
    expect(callArgs.tools.updateFragment).toBeDefined()
    expect(callArgs.tools.editFragment).toBeDefined()
    expect(callArgs.tools.deleteFragment).toBeDefined()
    // Should have generic read tools
    expect(callArgs.tools.getFragment).toBeDefined()
    expect(callArgs.tools.listFragments).toBeDefined()
    expect(callArgs.tools.searchFragments).toBeDefined()
    expect(callArgs.tools.listFragmentTypes).toBeDefined()
    // Should have editProse for sweeping prose changes
    expect(callArgs.tools.editProse).toBeDefined()
  })

  it('includes conversation history in messages', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('Updated.') as any,
    )

    await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'List characters' },
          { role: 'assistant', content: 'You have Alice and Bob.' },
          { role: 'user', content: 'Update Alice to be older' },
        ],
      }),
    })

    const callArgs = mockedStreamText.mock.calls[0][0] as any

    // Messages should include context + conversation history
    // First two are the context injection pair, then conversation
    expect(callArgs.messages.length).toBeGreaterThanOrEqual(5)

    // Last message should be the user's latest
    const lastMsg = callArgs.messages[callArgs.messages.length - 1]
    expect(lastMsg.role).toBe('user')
    expect(lastMsg.content).toContain('Update Alice to be older')
  })

  it('includes chat system prompt', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('Done.') as any,
    )

    await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })

    const callArgs = mockedStreamText.mock.calls[0][0] as any
    expect(callArgs.system).toContain('Librarian')
    expect(callArgs.system).toContain('including prose')
    expect(callArgs.system).toContain('editFragment')
    expect(callArgs.system).toContain('searchFragments')
  })

  it('includes story context in messages', async () => {
    // Create some fragments for context
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      type: 'prose',
      name: 'Prose 1',
      description: 'Opening',
      content: 'The hero entered the dark forest.',
    }))
    await initProseChain(dataDir, storyId, 'pr-0001')

    await createFragment(dataDir, storyId, makeFragment({
      id: 'ch-0001',
      type: 'character',
      name: 'Alice',
      sticky: true,
    }))

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Done.') as any,
    )

    await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What is the story about?' }],
      }),
    })

    const callArgs = mockedStreamText.mock.calls[0][0] as any

    // First message should contain story context
    const contextMsg = callArgs.messages[0].content
    expect(contextMsg).toContain('Test Story')
    expect(contextMsg).toContain('hero enters a forest')
    // Prose fragments should be tagged with IDs for direct editing
    expect(contextMsg).toContain('[pr-0001]')
    expect(contextMsg).toContain('editable via')
  })

  it('uses maxSteps from story settings', async () => {
    // Update story settings
    await createStory(dataDir, makeStory({
      settings: {
        outputFormat: 'markdown',
        enabledPlugins: [],
        summarizationThreshold: 4,
        maxSteps: 3,
        providerId: null,
        modelId: null,
        contextOrderMode: 'simple' as const,
        fragmentOrder: [],
      },
    }))

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Done.') as any,
    )

    await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })

    const callArgs = mockedStreamText.mock.calls[0][0] as any
    // stopWhen should be called with stepCountIs(3)
    expect(callArgs.stopWhen).toBeDefined()
  })

  it('persists chat history after completion', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('Here is my response.') as any,
    )

    const res = await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello librarian' }],
      }),
    })

    expect(res.status).toBe(200)
    // Consume the stream to trigger completion
    await res.text()

    // Wait briefly for background persistence
    await new Promise((r) => setTimeout(r, 50))

    // Retrieve persisted history
    const historyRes = await api(`/stories/${storyId}/librarian/chat`)
    expect(historyRes.status).toBe(200)
    const history = await historyRes.json() as { messages: Array<{ role: string; content: string }>; updatedAt: string }
    expect(history.messages).toHaveLength(2)
    expect(history.messages[0].role).toBe('user')
    expect(history.messages[0].content).toBe('Hello librarian')
    expect(history.messages[1].role).toBe('assistant')
    expect(history.messages[1].content).toBe('Here is my response.')
  })

  it('returns empty history when none exists', async () => {
    const res = await api(`/stories/${storyId}/librarian/chat`)
    expect(res.status).toBe(200)
    const history = await res.json() as { messages: Array<unknown>; updatedAt: string }
    expect(history.messages).toHaveLength(0)
  })

  it('clears chat history via DELETE', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('Response.') as any,
    )

    // Create some history
    const postRes = await api(`/stories/${storyId}/librarian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })
    await postRes.text()
    await new Promise((r) => setTimeout(r, 50))

    // Verify it exists
    const beforeRes = await api(`/stories/${storyId}/librarian/chat`)
    const before = await beforeRes.json() as { messages: Array<unknown> }
    expect(before.messages.length).toBeGreaterThan(0)

    // Clear it
    const deleteRes = await api(`/stories/${storyId}/librarian/chat`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)

    // Verify it's gone
    const afterRes = await api(`/stories/${storyId}/librarian/chat`)
    const after = await afterRes.json() as { messages: Array<unknown> }
    expect(after.messages).toHaveLength(0)
  })
})
