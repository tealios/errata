import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir, seedTestProvider, makeTestSettings } from '../setup'
import {
  createStory,
  createFragment,
} from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

// Mock the AI SDK ToolLoopAgent
const mockAgentInstances: Array<{ stream: ReturnType<typeof vi.fn> }> = []
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

function makeFragment(overrides: Partial<Fragment> = {}): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'ch-hero',
    type: 'character',
    name: 'Kael',
    description: 'A mysterious wanderer',
    content: 'Kael is a wanderer who speaks in riddles and carries a wooden staff.',
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

async function* createMockFullStream(events: Array<{ type: string; [key: string]: unknown }>): AsyncGenerator<unknown> {
  for (const event of events) {
    yield event
  }
}

function mockSimpleResponse() {
  mockAgentStream.mockResolvedValue({
    fullStream: createMockFullStream([
      { type: 'text-delta', text: 'Greetings, traveler.' },
      { type: 'finish', finishReason: 'stop' },
    ]),
    text: Promise.resolve('Greetings, traveler.'),
    reasoning: Promise.resolve(''),
    toolCalls: Promise.resolve([]),
    finishReason: Promise.resolve('stop'),
    steps: Promise.resolve([]),
  })
}

function mockEmptyResponse() {
  mockAgentStream.mockResolvedValue({
    fullStream: createMockFullStream([{ type: 'finish', finishReason: 'stop', stepCount: 1 }]),
    text: Promise.resolve(''),
    reasoning: Promise.resolve(''),
    toolCalls: Promise.resolve([]),
    finishReason: Promise.resolve('stop'),
    steps: Promise.resolve([]),
  })
}

async function readNdjsonStream(res: Response): Promise<Array<Record<string, unknown>>> {
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
      if (line.trim()) events.push(JSON.parse(line))
    }
  }
  return events
}

describe('character chat endpoints', () => {
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

  async function createTestConversation(storyId: string, body?: Record<string, unknown>) {
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${storyId}/character-chat/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {
          characterId: 'ch-hero',
          persona: { type: 'stranger' },
        }),
      }),
    )
    return res
  }

  describe('conversation CRUD', () => {
    it('creates a conversation', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      const res = await createTestConversation(story.id)
      expect(res.status).toBe(200)

      const conv = await res.json()
      expect(conv.id).toMatch(/^cc-/)
      expect(conv.characterId).toBe('ch-hero')
      expect(conv.persona).toEqual({ type: 'stranger' })
      expect(conv.title).toBe('Chat with Kael')
      expect(conv.messages).toEqual([])
    })

    it('creates a conversation with custom title', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      const res = await createTestConversation(story.id, {
        characterId: 'ch-hero',
        persona: { type: 'stranger' },
        title: 'My Custom Chat',
      })
      const conv = await res.json()
      expect(conv.title).toBe('My Custom Chat')
    })

    it('returns 404 for missing character', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      const res = await createTestConversation(story.id, {
        characterId: 'ch-nonexistent',
        persona: { type: 'stranger' },
      })
      expect(res.status).toBe(404)
    })

    it('lists conversations', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      await createTestConversation(story.id)
      await createTestConversation(story.id)

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations`),
      )
      expect(res.status).toBe(200)
      const list = await res.json()
      expect(list).toHaveLength(2)
    })

    it('lists conversations filtered by characterId', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())
      await createFragment(dataDir, story.id, makeFragment({ id: 'ch-villain', name: 'Villain', type: 'character' }))

      await createTestConversation(story.id, { characterId: 'ch-hero', persona: { type: 'stranger' } })
      await createTestConversation(story.id, { characterId: 'ch-villain', persona: { type: 'stranger' } })

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations?characterId=ch-hero`),
      )
      const list = await res.json()
      expect(list).toHaveLength(1)
      expect(list[0].characterId).toBe('ch-hero')
    })

    it('gets a conversation by id', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      const createRes = await createTestConversation(story.id)
      const conv = await createRes.json()

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/${conv.id}`),
      )
      expect(res.status).toBe(200)
      const loaded = await res.json()
      expect(loaded.id).toBe(conv.id)
    })

    it('returns 404 for nonexistent conversation', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/cc-nonexistent`),
      )
      expect(res.status).toBe(404)
    })

    it('deletes a conversation', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      const createRes = await createTestConversation(story.id)
      const conv = await createRes.json()

      const deleteRes = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/${conv.id}`, {
          method: 'DELETE',
        }),
      )
      expect(deleteRes.status).toBe(200)

      const getRes = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/${conv.id}`),
      )
      expect(getRes.status).toBe(404)
    })
  })

  describe('chat streaming', () => {
    it('streams NDJSON text events', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      const createRes = await createTestConversation(story.id)
      const conv = await createRes.json()

      mockSimpleResponse()

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/${conv.id}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        }),
      )

      expect(res.status).toBe(200)
      const events = await readNdjsonStream(res)

      const textEvents = events.filter((e) => e.type === 'text')
      expect(textEvents.length).toBeGreaterThan(0)
      expect(textEvents[0].text).toBe('Greetings, traveler.')

      const finishEvent = events.find((e) => e.type === 'finish')
      expect(finishEvent).toBeDefined()
    })

    it('streams reasoning events', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      const createRes = await createTestConversation(story.id)
      const conv = await createRes.json()

      mockAgentStream.mockResolvedValue({
        fullStream: createMockFullStream([
          { type: 'reasoning-delta', text: 'I am Kael, I should speak in riddles.' },
          { type: 'text-delta', text: 'The path reveals itself to those who wander.' },
          { type: 'finish', finishReason: 'stop' },
        ]),
        text: Promise.resolve('The path reveals itself to those who wander.'),
        reasoning: Promise.resolve('I am Kael, I should speak in riddles.'),
        toolCalls: Promise.resolve([]),
        finishReason: Promise.resolve('stop'),
        steps: Promise.resolve([]),
      })

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/${conv.id}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Where should I go?' }],
          }),
        }),
      )

      const events = await readNdjsonStream(res)
      const reasoningEvent = events.find((e) => e.type === 'reasoning')
      expect(reasoningEvent).toBeDefined()
      expect(reasoningEvent!.text).toContain('riddles')
    })

    it('uses read-only tools (no write tools)', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      const createRes = await createTestConversation(story.id)
      const conv = await createRes.json()

      mockEmptyResponse()

      await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/${conv.id}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        }),
      )

      expect(mockAgentCtor).toHaveBeenCalled()
      const config = mockAgentCtor.mock.calls[0][0]
      const toolNames = Object.keys(config.tools)

      // Should have read tools but NOT write tools
      expect(toolNames.some((n: string) => n.startsWith('get') || n.startsWith('list') || n.startsWith('search'))).toBe(true)
      expect(toolNames).not.toContain('editProse')
      expect(toolNames).not.toContain('createFragment')
      expect(toolNames).not.toContain('deleteFragment')
    })

    it('includes character name in system prompt', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      const createRes = await createTestConversation(story.id)
      const conv = await createRes.json()

      mockEmptyResponse()

      await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/${conv.id}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        }),
      )

      expect(mockAgentCtor).toHaveBeenCalled()
      const config = mockAgentCtor.mock.calls[0][0]
      expect(config.instructions).toContain('Kael')
      expect(config.instructions).toContain('riddles')
    })

    it('returns 404 when conversation does not exist', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/cc-nonexistent/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        }),
      )
      expect(res.status).toBe(404)
    })

    it('returns 422 when messages array is empty', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      const createRes = await createTestConversation(story.id)
      const conv = await createRes.json()

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/${conv.id}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [] }),
        }),
      )
      expect(res.status).toBe(422)
    })

    it('persists conversation after completion', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment())

      const createRes = await createTestConversation(story.id)
      const conv = await createRes.json()

      mockSimpleResponse()

      await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/${conv.id}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Hello Kael' }],
          }),
        }),
      )

      // Wait for async persistence
      await new Promise((r) => setTimeout(r, 100))

      const getRes = await app.fetch(
        new Request(`http://localhost/api/stories/${story.id}/character-chat/conversations/${conv.id}`),
      )
      const loaded = await getRes.json()
      expect(loaded.messages).toHaveLength(2)
      expect(loaded.messages[0].role).toBe('user')
      expect(loaded.messages[0].content).toBe('Hello Kael')
      expect(loaded.messages[1].role).toBe('assistant')
      expect(loaded.messages[1].content).toBe('Greetings, traveler.')
    })
  })
})
