import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir, seedTestProvider, makeTestSettings } from '../setup'
import {
  createStory,
  createFragment,
} from '@/server/fragments/storage'
import { initProseChain } from '@/server/fragments/prose-chain'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

// Mock the AI SDK ToolLoopAgent
const mockAgentInstances: Array<{ stream: ReturnType<typeof vi.fn>; fullStream?: ReadableStream<unknown> }> = []
const mockAgentCtor = vi.fn()
const mockAgentStream = vi.fn()

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    ToolLoopAgent: class MockToolLoopAgent {
      constructor(config: unknown) {
        mockAgentCtor(config)
        const instance = { stream: mockAgentStream }
        mockAgentInstances.push(instance)
        return instance as unknown as MockToolLoopAgent
      }
    },
  }
})

import { createApp } from '@/server/api'

function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    summary: 'A hero enters a forest.',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
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
    archived: false,
    ...overrides,
  }
}

// Helper to create a mock async iterable fullStream for NDJSON events
async function* createMockFullStream(events: Array<{ type: string; [key: string]: unknown }>): AsyncGenerator<unknown> {
  for (const event of events) {
    yield event
  }
}

describe('librarian chat endpoint', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await seedTestProvider(dataDir)
    app = createApp(dataDir)
    mockAgentInstances.length = 0
    mockAgentCtor.mockClear()
    mockAgentStream.mockClear()
  })

  afterEach(async () => {
    await cleanup()
  })

  it('streams NDJSON events for a text-only response', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    // Mock the agent to return a simple text response
    mockAgentStream.mockResolvedValue({
      fullStream: createMockFullStream([
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' world' },
        { type: 'finish', finishReason: 'stop' },
      ]),
      text: Promise.resolve('Hello world'),
      reasoning: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
    })

    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
    )

    expect(res.status).toBe(200)
    const contentType = res.headers.get('content-type')
    expect(contentType === 'text/event-stream' || contentType === 'application/x-ndjson; charset=utf-8').toBe(true)

    // Read the NDJSON stream
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const events: Array<Record<string, unknown>> = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) {
          events.push(JSON.parse(line))
        }
      }
    }

    // Should have text events and a finish event
    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents.length).toBeGreaterThan(0)
    expect(textEvents[0].text).toBe('Hello')
    expect(textEvents[1].text).toBe(' world')

    const finishEvent = events.find((e) => e.type === 'finish')
    expect(finishEvent).toBeDefined()
    expect(finishEvent!.finishReason).toBe('stop')
  })

  it('streams tool-call and tool-result events', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    // Create a prose fragment for editing
    const fragment = makeFragment({ type: 'prose', id: 'pr-0001', name: 'Opening' })
    await createFragment(dataDir, story.id, fragment)
    await initProseChain(dataDir, story.id, fragment.id)

    mockAgentStream.mockResolvedValue({
      fullStream: createMockFullStream([
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'editProse',
          input: { oldText: 'test', newText: 'modified' },
        },
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'editProse',
          output: { ok: true },
        },
        { type: 'finish', finishReason: 'stop' },
      ]),
      text: Promise.resolve(''),
      reasoning: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
    })

    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Edit the prose' }],
        }),
      }),
    )

    expect(res.status).toBe(200)

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const events: Array<Record<string, unknown>> = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) {
          events.push(JSON.parse(line))
        }
      }
    }

    const toolCallEvent = events.find((e) => e.type === 'tool-call')
    expect(toolCallEvent).toBeDefined()
    expect(toolCallEvent!.toolName).toBe('editProse')

    const toolResultEvent = events.find((e) => e.type === 'tool-result')
    expect(toolResultEvent).toBeDefined()
    expect(toolResultEvent!.toolName).toBe('editProse')
  })

  it('streams reasoning events', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    mockAgentStream.mockResolvedValue({
      fullStream: createMockFullStream([
        { type: 'reasoning-delta', text: 'Thinking about the answer...' },
        { type: 'text-delta', text: 'Final answer' },
        { type: 'finish', finishReason: 'stop' },
      ]),
      text: Promise.resolve('Final answer'),
      reasoning: Promise.resolve('Thinking about the answer...'),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
    })

    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Why is the sky blue?' }],
        }),
      }),
    )

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const events: Array<Record<string, unknown>> = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) {
          events.push(JSON.parse(line))
        }
      }
    }

    const reasoningEvent = events.find((e) => e.type === 'reasoning')
    expect(reasoningEvent).toBeDefined()
    expect(reasoningEvent!.text).toBe('Thinking about the answer...')

    const textEvent = events.find((e) => e.type === 'text')
    expect(textEvent).toBeDefined()
    expect(textEvent!.text).toBe('Final answer')
  })

  it('passes write-enabled tools to streamText', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    mockAgentStream.mockResolvedValue({
      fullStream: createMockFullStream([{ type: 'finish', finishReason: 'stop', stepCount: 1 }]),
      text: Promise.resolve(''),
      reasoning: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
    })

    await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'List characters' }],
        }),
      }),
    )

    // Verify ToolLoopAgent was created with tools
    expect(mockAgentCtor).toHaveBeenCalled()
    const config = mockAgentCtor.mock.calls[0][0]
    expect(config.tools).toBeDefined()
    expect(Object.keys(config.tools).length).toBeGreaterThan(0)
  })

  it('includes reanalyzeFragment tool', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    mockAgentStream.mockResolvedValue({
      fullStream: createMockFullStream([{ type: 'finish', finishReason: 'stop', stepCount: 1 }]),
      text: Promise.resolve(''),
      reasoning: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
    })

    await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Reanalyze the prose' }],
        }),
      }),
    )

    expect(mockAgentCtor).toHaveBeenCalled()
    const config = mockAgentCtor.mock.calls[0][0]
    expect(config.tools.reanalyzeFragment).toBeDefined()
    expect(config.instructions).toContain('reanalyzeFragment')
  })

  it('includes conversation history in messages', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    mockAgentStream.mockResolvedValue({
      fullStream: createMockFullStream([{ type: 'finish', finishReason: 'stop', stepCount: 1 }]),
      text: Promise.resolve(''),
      reasoning: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
    })

    await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
            { role: 'user', content: 'How are you?' },
          ],
        }),
      }),
    )

    expect(mockAgentStream).toHaveBeenCalled()
    const callArgs = mockAgentStream.mock.calls[0][0]
    const messages = callArgs.messages

    // Should include context messages plus conversation
    expect(messages.length).toBeGreaterThan(3)
    expect(messages.some((m: { role: string; content: string }) => m.role === 'user' && m.content === 'Hello')).toBe(true)
    expect(messages.some((m: { role: string; content: string }) => m.role === 'assistant' && m.content === 'Hi there!')).toBe(true)
    expect(messages.some((m: { role: string; content: string }) => m.role === 'user' && m.content === 'How are you?')).toBe(true)
  })

  it('includes chat system prompt', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    mockAgentStream.mockResolvedValue({
      fullStream: createMockFullStream([{ type: 'finish', finishReason: 'stop', stepCount: 1 }]),
      text: Promise.resolve(''),
      reasoning: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
    })

    await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
    )

    expect(mockAgentCtor).toHaveBeenCalled()
    const config = mockAgentCtor.mock.calls[0][0]
    expect(config.instructions).toContain('librarian')
    expect(config.instructions).toContain('editProse')
  })

  it('includes story context in messages', async () => {
    const story = makeStory({ summary: 'Epic fantasy tale' })
    await createStory(dataDir, story)

    const fragment = makeFragment({ type: 'prose', id: 'pr-0001', name: 'Opening' })
    await createFragment(dataDir, story.id, fragment)
    await initProseChain(dataDir, story.id, fragment.id)

    mockAgentStream.mockResolvedValue({
      fullStream: createMockFullStream([{ type: 'finish', finishReason: 'stop', stepCount: 1 }]),
      text: Promise.resolve(''),
      reasoning: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
    })

    await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
    )

    expect(mockAgentStream).toHaveBeenCalled()
    const callArgs = mockAgentStream.mock.calls[0][0]
    const contextMessage = callArgs.messages[0].content as string

    expect(contextMessage).toContain('Test Story')
    expect(contextMessage).toContain('Epic fantasy tale')
  })

  it('uses maxSteps from story settings', async () => {
    const story = makeStory({ settings: { ...makeStory().settings, maxSteps: 5 } })
    await createStory(dataDir, story)

    mockAgentStream.mockResolvedValue({
      fullStream: createMockFullStream([{ type: 'finish', finishReason: 'stop', stepCount: 1 }]),
      text: Promise.resolve(''),
      reasoning: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
    })

    await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          maxSteps: 3,
        }),
      }),
    )

    expect(mockAgentCtor).toHaveBeenCalled()
    const config = mockAgentCtor.mock.calls[0][0]
    expect(config.stopWhen).toBeDefined()
  })

  it('persists chat history after completion', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    mockAgentStream.mockResolvedValue({
      fullStream: createMockFullStream([
        { type: 'text-delta', text: 'Here is my response.' },
        { type: 'finish', finishReason: 'stop' },
      ]),
      text: Promise.resolve('Here is my response.'),
      reasoning: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
    })

    await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello librarian' }],
        }),
      }),
    )

    // Wait for async persistence
    await new Promise((r) => setTimeout(r, 100))

    // Fetch the persisted history
    const historyRes = await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/chat`),
    )
    expect(historyRes.status).toBe(200)
    const history = await historyRes.json()

    expect(history.messages).toHaveLength(2)
    expect(history.messages[0].role).toBe('user')
    expect(history.messages[0].content).toBe('Hello librarian')
    expect(history.messages[1].role).toBe('assistant')
    expect(history.messages[1].content).toBe('Here is my response.')
  })
})
