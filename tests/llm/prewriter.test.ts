import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir, seedTestProvider, makeTestSettings } from '../setup'
import {
  createStory,
  createFragment,
} from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

const { mockAgentCtor, mockAgentStream } = vi.hoisted(() => ({
  mockAgentCtor: vi.fn(),
  mockAgentStream: vi.fn(),
}))

// Mock the AI SDK ToolLoopAgent
vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    ToolLoopAgent: class {
      constructor(config: unknown) {
        mockAgentCtor(config)
      }

      stream(args: unknown) {
        return mockAgentStream(args)
      }
    },
  }
})

import { createApp } from '@/server/api'
import { createPrewriterBlocks, createWriterBriefBlocks } from '@/server/llm/prewriter'
import type { AgentBlockContext } from '@/server/agents/agent-block-context'

function makeStory(overrides?: Partial<StoryMeta['settings']>): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: 'A summary of the test story.',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(overrides),
  }
}

function makeFragment(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'pr-0001',
    type: 'prose',
    name: 'Test',
    description: 'A test fragment',
    content: 'Test content',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user' as const,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    ...overrides,
  }
}

function createMockStreamResult(text: string) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })

  const textStream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue(text)
      controller.close()
    },
  })

  async function* generateFullStream() {
    yield { type: 'text-delta' as const, text }
    yield { type: 'finish' as const, finishReason: 'stop' }
  }
  const fullStream = generateFullStream()

  return {
    textStream,
    fullStream,
    text: Promise.resolve(text),
    usage: Promise.resolve({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }),
    totalUsage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
    finishReason: Promise.resolve('stop' as const),
    steps: Promise.resolve([]),
    toTextStreamResponse: () => new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
    toUIMessageStreamResponse: () => new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
  }
}

/** Parse NDJSON response body into an array of events */
async function parseNDJSON(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text()
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

describe('prewriter', () => {
  describe('createPrewriterBlocks', () => {
    it('creates expected block structure', () => {
      const ctx: AgentBlockContext = {
        story: makeStory(),
        proseFragments: [],
        stickyGuidelines: [],
        stickyKnowledge: [],
        stickyCharacters: [],
        guidelineShortlist: [],
        knowledgeShortlist: [],
        characterShortlist: [],
        systemPromptFragments: [],
      }

      const blocks = createPrewriterBlocks(ctx)

      expect(blocks).toHaveLength(3)

      const ids = blocks.map((b) => b.id)
      expect(ids).toContain('instructions')
      expect(ids).toContain('full-context')
      expect(ids).toContain('planning-request')

      // Instructions should be a system block
      const instructions = blocks.find((b) => b.id === 'instructions')!
      expect(instructions.role).toBe('system')
      expect(instructions.content).toContain('writing planner')
      expect(instructions.content).toContain('WRITING BRIEF')

      // full-context and planning-request should be user blocks
      const fullContext = blocks.find((b) => b.id === 'full-context')!
      expect(fullContext.role).toBe('user')

      const planningRequest = blocks.find((b) => b.id === 'planning-request')!
      expect(planningRequest.role).toBe('user')
    })
  })

  describe('createWriterBriefBlocks', () => {
    it('creates stripped context with only instructions, tools, prose, and writing-brief', () => {
      const proseFragments = [
        makeFragment({ id: 'pr-0001', content: 'The rain fell softly.' }),
        makeFragment({ id: 'pr-0002', content: 'She opened the door.' }),
      ]
      const brief = 'Write a continuation focusing on character dialogue.'
      const toolLines = [
        '- getCharacter(id): Get full content of a character fragment',
        '- listCharacters(): List all character fragments',
      ]

      const blocks = createWriterBriefBlocks(proseFragments, brief, toolLines)

      const ids = blocks.map((b) => b.id)
      expect(ids).toContain('instructions')
      expect(ids).toContain('tools')
      expect(ids).toContain('prose')
      expect(ids).toContain('writing-brief')

      // Should NOT contain any of the full context blocks
      expect(ids).not.toContain('story-info')
      expect(ids).not.toContain('summary')
      expect(ids).not.toContain('user-fragments')
      expect(ids).not.toContain('shortlist-guidelines')
      expect(ids).not.toContain('shortlist-knowledge')
      expect(ids).not.toContain('shortlist-characters')
      expect(ids).not.toContain('author-input')
      expect(ids).not.toContain('system-fragments')

      // Instructions should mention the writing brief
      const instructions = blocks.find((b) => b.id === 'instructions')!
      expect(instructions.content).toContain('WRITING BRIEF')

      // Prose should contain the fragment content
      const prose = blocks.find((b) => b.id === 'prose')!
      expect(prose.content).toContain('The rain fell softly.')
      expect(prose.content).toContain('She opened the door.')

      // Brief should contain the prewriter output
      const writingBrief = blocks.find((b) => b.id === 'writing-brief')!
      expect(writingBrief.content).toContain(brief)
    })

    it('omits tools block when no tool lines provided', () => {
      const blocks = createWriterBriefBlocks([], 'A brief.', [])
      const ids = blocks.map((b) => b.id)
      expect(ids).not.toContain('tools')
    })

    it('omits prose block when no prose fragments provided', () => {
      const blocks = createWriterBriefBlocks([], 'A brief.', ['- someTool(): Do something'])
      const ids = blocks.map((b) => b.id)
      expect(ids).not.toContain('prose')
    })
  })

  describe('generation route with prewriter', () => {
    let dataDir: string
    let cleanup: () => Promise<void>
    let app: ReturnType<typeof createApp>
    const storyId = 'story-test'

    async function apiCall(path: string, init?: RequestInit) {
      const res = await app.fetch(
        new Request(`http://localhost/api${path}`, init),
      )
      return res
    }

    beforeEach(async () => {
      const tmp = await createTempDir()
      dataDir = tmp.path
      cleanup = tmp.cleanup
      await seedTestProvider(dataDir)
      app = createApp(dataDir)
      vi.clearAllMocks()
    })

    afterEach(async () => {
      await cleanup()
    })

    it('standard mode (default) does not emit phase events', async () => {
      await createStory(dataDir, makeStory())

      mockAgentStream.mockResolvedValue(
        createMockStreamResult('The sun rose.') as any,
      )

      const res = await apiCall(`/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'Continue the story',
          saveResult: false,
        }),
      })

      expect(res.status).toBe(200)

      const events = await parseNDJSON(res)
      const phaseEvents = events.filter((e) => e.type === 'phase')
      expect(phaseEvents).toHaveLength(0)

      // Should only have the writer agent call (no prewriter)
      expect(mockAgentCtor).toHaveBeenCalledTimes(1)
    })

    it('prewriter mode emits phase events in NDJSON stream', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter' }))

      // First call is prewriter, second is writer
      let callCount = 0
      mockAgentStream.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // Prewriter returns a brief
          return createMockStreamResult('## Writing Brief\nFocus on dialogue.') as any
        }
        // Writer returns prose
        return createMockStreamResult('She whispered softly.') as any
      })

      const res = await apiCall(`/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'Continue the story',
          saveResult: false,
        }),
      })

      expect(res.status).toBe(200)

      const events = await parseNDJSON(res)
      const phaseEvents = events.filter((e) => e.type === 'phase')
      expect(phaseEvents).toHaveLength(2)
      expect(phaseEvents[0]).toEqual({ type: 'phase', phase: 'prewriting' })
      expect(phaseEvents[1]).toEqual({ type: 'phase', phase: 'writing' })

      // Two ToolLoopAgent instances: prewriter + writer
      expect(mockAgentCtor).toHaveBeenCalledTimes(2)

      // Prewriter agent should have toolChoice='none'
      const prewriterConfig = mockAgentCtor.mock.calls[0][0] as any
      expect(prewriterConfig.toolChoice).toBe('none')

      // Writer agent should have toolChoice='auto'
      const writerConfig = mockAgentCtor.mock.calls[1][0] as any
      expect(writerConfig.toolChoice).toBe('auto')
    })

    it('prewriter mode passes stripped context to writer', async () => {
      // Create story with prewriter mode and some context fragments
      await createStory(dataDir, makeStory({ generationMode: 'prewriter' }))

      const guideline = makeFragment({
        id: 'gl-0001',
        type: 'guideline',
        name: 'Tone',
        description: 'Dark tone',
        content: 'Dark gothic style.',
        sticky: true,
      })
      await createFragment(dataDir, storyId, guideline)

      let callCount = 0
      mockAgentStream.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockStreamResult('Focus on dark atmosphere.') as any
        }
        return createMockStreamResult('The shadows crept forward.') as any
      })

      const res = await apiCall(`/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'Continue darkly',
          saveResult: false,
        }),
      })

      expect(res.status).toBe(200)
      await res.text()

      // Writer should receive the stripped context (with writing brief, not full fragments)
      const writerStreamArgs = mockAgentStream.mock.calls[1][0] as any
      const writerMessages = writerStreamArgs.messages!

      // Find the user message
      const userMsg = writerMessages.find((m: any) => m.role === 'user')
      const userText = typeof userMsg?.content === 'string'
        ? userMsg.content
        : userMsg?.content?.map((p: any) => p.text).join('') ?? ''

      // Writer should see the writing brief
      expect(userText).toContain('Writing Brief')
      expect(userText).toContain('Focus on dark atmosphere.')

      // Writer should NOT see the raw guideline content (that's in the full context, not the brief)
      expect(userText).not.toContain('Dark gothic style.')
    })

    it('prewriter mode saves prewriter metadata in generation log', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter' }))

      let callCount = 0
      mockAgentStream.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockStreamResult('Brief: focus on dialogue.') as any
        }
        return createMockStreamResult('Hello, she said.') as any
      })

      const res = await apiCall(`/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'Write dialogue',
          saveResult: true,
        }),
      })

      expect(res.status).toBe(200)
      await res.text()
      await new Promise((r) => setTimeout(r, 200))

      // Check generation log for prewriter metadata
      const { listGenerationLogs } = await import('@/server/llm/generation-logs')
      const logs = await listGenerationLogs(dataDir, storyId)
      expect(logs.length).toBeGreaterThan(0)

      const { getGenerationLog } = await import('@/server/llm/generation-logs')
      const log = await getGenerationLog(dataDir, storyId, logs[0].id)
      expect(log).toBeDefined()
      expect(log!.prewriterBrief).toBe('Brief: focus on dialogue.')
      expect(log!.prewriterModel).toBeDefined()
      expect(log!.prewriterDurationMs).toBeGreaterThan(0)
    })

    it('mode-specific planning prompts differ for generate vs regenerate', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter' }))

      // Create a fragment for regeneration
      const existing = makeFragment({
        id: 'pr-regen',
        content: 'Original content.',
      })
      await createFragment(dataDir, storyId, existing)

      let callCount = 0
      mockAgentStream.mockImplementation(() => {
        callCount++
        // Capture prewriter stream args (odd calls are prewriter)
        if (callCount % 2 === 1) {
          const result = createMockStreamResult('A brief.') as any
          return result
        }
        return createMockStreamResult('Generated prose.') as any
      })

      // Generate mode
      const res1 = await apiCall(`/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'Continue the story',
          saveResult: false,
        }),
      })
      await res1.text()

      // Capture the prewriter messages from first call
      const prewriterArgs1 = mockAgentStream.mock.calls[0][0] as any
      const prewriterUserMsg1 = prewriterArgs1.messages?.find((m: any) => m.role === 'user')
      const prewriterText1 = typeof prewriterUserMsg1?.content === 'string'
        ? prewriterUserMsg1.content
        : prewriterUserMsg1?.content?.map((p: any) => p.text).join('') ?? ''

      expect(prewriterText1).toContain('CONTINUE')

      // Regenerate mode
      callCount = 0
      vi.clearAllMocks()
      mockAgentStream.mockImplementation(() => {
        callCount++
        if (callCount % 2 === 1) {
          return createMockStreamResult('A regen brief.') as any
        }
        return createMockStreamResult('Regen prose.') as any
      })

      const res2 = await apiCall(`/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'Try a different approach',
          saveResult: false,
          mode: 'regenerate',
          fragmentId: 'pr-regen',
        }),
      })
      await res2.text()

      const prewriterArgs2 = mockAgentStream.mock.calls[0][0] as any
      const prewriterUserMsg2 = prewriterArgs2.messages?.find((m: any) => m.role === 'user')
      const prewriterText2 = typeof prewriterUserMsg2?.content === 'string'
        ? prewriterUserMsg2.content
        : prewriterUserMsg2?.content?.map((p: any) => p.text).join('') ?? ''

      expect(prewriterText2).toContain('REGENERATE')
    })
  })
})
