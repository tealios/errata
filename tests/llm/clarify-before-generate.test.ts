import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { ensureCoreAgentsRegistered } from '@/server/agents/register-core'
import { createTempDir, seedTestProvider, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'
import { StoryMetaSchema, type StoryMeta } from '@/server/fragments/schema'

const { mockAgentCtor, mockAgentStream } = vi.hoisted(() => ({
  mockAgentCtor: vi.fn(),
  mockAgentStream: vi.fn(),
}))

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
import { createFragment } from '@/server/fragments/storage'
import { ClarifyQuestionsInputSchema, MAX_CLARIFY_ROUNDS } from '@/server/llm/prewriter'
import type { Fragment } from '@/server/fragments/schema'

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

function createMockStreamResult(text: string) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
  async function* generateFullStream() {
    yield { type: 'text-delta' as const, text }
    yield { type: 'finish' as const, finishReason: 'stop' }
  }
  return {
    textStream: new ReadableStream<string>({
      start(c) { c.enqueue(text); c.close() },
    }),
    fullStream: generateFullStream(),
    text: Promise.resolve(text),
    usage: Promise.resolve({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }),
    totalUsage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
    finishReason: Promise.resolve('stop' as const),
    steps: Promise.resolve([]),
    toTextStreamResponse: () => new Response(stream),
    toUIMessageStreamResponse: () => new Response(stream),
  }
}

async function parseNDJSON(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text()
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

/** The tools handed to the most recently constructed agent. */
function lastAgentTools(): Record<string, unknown> {
  const cfg = mockAgentCtor.mock.calls.at(-1)?.[0] as { tools?: Record<string, unknown> }
  return cfg?.tools ?? {}
}

/** Tools handed to the FIRST constructed agent (the prewriter). */
function prewriterTools(): Record<string, unknown> {
  const cfg = mockAgentCtor.mock.calls[0]?.[0] as { tools?: Record<string, unknown> }
  return cfg?.tools ?? {}
}

const SAMPLE_QUESTION = {
  question: 'Whose point of view should this passage follow?',
  header: 'POV',
  multiSelect: false,
  options: [{ label: 'Alice' }, { label: 'Bob' }],
}

function makeProseFragment(id: string): Fragment {
  const now = new Date().toISOString()
  return { id, type: 'prose', name: id, description: '', content: 'Prior prose.', tags: [], refs: [], sticky: false, placement: 'user', createdAt: now, updatedAt: now, order: 0, meta: {}, archived: false }
}

describe('askQuestions input schema', () => {
  const one = (q: unknown) => ClarifyQuestionsInputSchema.safeParse({ questions: [q] })

  it('accepts a question with 2-4 options', () => {
    expect(one({ question: 'Whose POV?', header: 'POV', options: [{ label: 'Alice' }, { label: 'Bob' }] }).success).toBe(true)
  })
  it('accepts a free-text question (no options)', () => {
    expect(one({ question: 'What is the mood?', header: 'Mood' }).success).toBe(true)
  })
  it('accepts an option description and multiSelect', () => {
    expect(one({ question: 'q', header: 'h', multiSelect: true, options: [{ label: 'a', description: 'desc' }, { label: 'b' }] }).success).toBe(true)
  })
  it('defaults multiSelect to false when omitted', () => {
    const parsed = ClarifyQuestionsInputSchema.parse({ questions: [{ question: 'q', header: 'h', options: [{ label: 'a' }, { label: 'b' }] }] })
    expect(parsed.questions[0].multiSelect).toBe(false)
  })
  it('rejects an empty questions array', () => {
    expect(ClarifyQuestionsInputSchema.safeParse({ questions: [] }).success).toBe(false)
  })
  it('rejects more than 4 questions', () => {
    const q = { question: 'q', header: 'h' }
    expect(ClarifyQuestionsInputSchema.safeParse({ questions: [q, q, q, q, q] }).success).toBe(false)
  })
  it('rejects a header longer than 12 chars', () => {
    expect(one({ question: 'q', header: 'ThisHeaderIsTooLong' }).success).toBe(false)
  })
  it('rejects fewer than 2 options', () => {
    expect(one({ question: 'q', header: 'h', options: [{ label: 'only-one' }] }).success).toBe(false)
  })
  it('rejects more than 4 options', () => {
    expect(one({ question: 'q', header: 'h', options: [1, 2, 3, 4, 5].map((n) => ({ label: `o${n}` })) }).success).toBe(false)
  })
})

describe('clarify-before-generate', () => {
  beforeAll(() => {
    ensureCoreAgentsRegistered()
  })

  it('settings schema defaults clarifyBeforeGenerate to false', () => {
    const parsed = StoryMetaSchema.parse({
      id: 'story-x',
      name: 'X',
      description: '',
      coverImage: null,
      summary: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    expect(parsed.settings.clarifyBeforeGenerate).toBe(false)
  })

  describe('generation route', () => {
    let dataDir: string
    let cleanup: () => Promise<void>
    let app: ReturnType<typeof createApp>
    const storyId = 'story-test'

    async function generate(body: Record<string, unknown>) {
      return app.fetch(new Request(`http://localhost/api/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }))
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

    it('omits the askQuestions tool when clarify is disabled', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', clarifyBeforeGenerate: false }))
      let n = 0
      mockAgentStream.mockImplementation(() => {
        n++
        return createMockStreamResult(n === 1 ? 'A brief.' : 'Some prose.') as never
      })

      const res = await generate({ input: 'Continue', saveResult: false })
      expect(res.status).toBe(200)
      await res.text()

      expect('askQuestions' in prewriterTools()).toBe(false)
    })

    it('exposes the askQuestions tool to the prewriter when clarify is enabled', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', clarifyBeforeGenerate: true }))
      let n = 0
      mockAgentStream.mockImplementation(() => {
        n++
        return createMockStreamResult(n === 1 ? 'A brief.' : 'Some prose.') as never
      })

      const res = await generate({ input: 'Continue', saveResult: false })
      expect(res.status).toBe(200)
      await res.text()

      expect('askQuestions' in prewriterTools()).toBe(true)
    })

    it('emits clarify-questions and skips the writer when the prewriter asks', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', clarifyBeforeGenerate: true }))

      // Simulate the model calling askQuestions during the prewriter step.
      mockAgentStream.mockImplementation(async () => {
        const tools = lastAgentTools() as { askQuestions?: { execute: (a: unknown) => Promise<unknown> } }
        if (tools.askQuestions) {
          await tools.askQuestions.execute({ questions: [SAMPLE_QUESTION] })
        }
        return createMockStreamResult('') as never
      })

      const res = await generate({ input: 'Continue', saveResult: true })
      expect(res.status).toBe(200)
      const events = await parseNDJSON(res)

      const clarify = events.find((e) => e.type === 'clarify-questions') as
        | { questions: Array<{ question: string }>; round: number } | undefined
      expect(clarify).toBeDefined()
      expect(clarify!.questions[0].question).toContain('point of view')
      expect(clarify!.round).toBe(0)

      // No prose text was emitted, and only the prewriter agent was constructed.
      expect(events.some((e) => e.type === 'text')).toBe(false)
      expect(mockAgentCtor).toHaveBeenCalledTimes(1)
    })

    it('does not save a fragment when the prewriter asks questions', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', clarifyBeforeGenerate: true }))
      mockAgentStream.mockImplementation(async () => {
        const tools = lastAgentTools() as { askQuestions?: { execute: (a: unknown) => Promise<unknown> } }
        if (tools.askQuestions) await tools.askQuestions.execute({ questions: [SAMPLE_QUESTION] })
        return createMockStreamResult('') as never
      })

      const res = await generate({ input: 'Continue', saveResult: true })
      await res.text()
      await new Promise((r) => setTimeout(r, 150))

      const { listGenerationLogs } = await import('@/server/llm/generation-logs')
      const logs = await listGenerationLogs(dataDir, storyId)
      expect(logs).toHaveLength(0)
    })

    it('proceeds to the writer with prior answers when clarifications are supplied', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', clarifyBeforeGenerate: true }))

      // Model writes a brief this round (does not call askQuestions).
      let n = 0
      mockAgentStream.mockImplementation(() => {
        n++
        return createMockStreamResult(n === 1 ? 'Brief: continue from Alice.' : 'Alice stepped forward.') as never
      })

      const res = await generate({
        input: 'Continue',
        saveResult: false,
        clarifyRound: 1,
        clarifications: [{ question: 'Whose POV?', answer: 'Alice' }],
      })
      expect(res.status).toBe(200)
      const events = await parseNDJSON(res)

      expect(events.some((e) => e.type === 'clarify-questions')).toBe(false)
      // Prewriter + writer were both constructed.
      expect(mockAgentCtor).toHaveBeenCalledTimes(2)

      // The prior answer is rendered into the prewriter prompt.
      const prewriterArgs = mockAgentStream.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> }
      const prewriterText = prewriterArgs.messages
        .map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
        .join('\n')
      expect(prewriterText).toContain('Alice')
      expect(prewriterText).toContain('Already Answered')
    })

    it('withholds the askQuestions tool once the round cap is reached', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', clarifyBeforeGenerate: true }))
      let n = 0
      mockAgentStream.mockImplementation(() => {
        n++
        return createMockStreamResult(n === 1 ? 'A brief.' : 'Some prose.') as never
      })

      const res = await generate({
        input: 'Continue',
        saveResult: false,
        clarifyRound: 3,
        clarifications: [{ question: 'q', answer: 'a' }],
      })
      expect(res.status).toBe(200)
      await res.text()

      expect('askQuestions' in prewriterTools()).toBe(false)
    })

    it('ignores clarify in standard mode (no prewriter, no questions)', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'standard', clarifyBeforeGenerate: true }))
      mockAgentStream.mockResolvedValue(createMockStreamResult('The sun rose.') as never)

      const res = await generate({ input: 'Continue', saveResult: false })
      expect(res.status).toBe(200)
      const events = await parseNDJSON(res)

      expect(events.some((e) => e.type === 'clarify-questions')).toBe(false)
      expect(mockAgentCtor).toHaveBeenCalledTimes(1)
      expect('askQuestions' in lastAgentTools()).toBe(false)
    })

    it('still offers the ask tool at the last allowed round (MAX-1)', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', clarifyBeforeGenerate: true }))
      let n = 0
      mockAgentStream.mockImplementation(() => { n++; return createMockStreamResult(n === 1 ? 'A brief.' : 'Prose.') as never })

      const res = await generate({
        input: 'Continue',
        saveResult: false,
        clarifyRound: MAX_CLARIFY_ROUNDS - 1,
        clarifications: [{ question: 'q', answer: 'a' }],
      })
      expect(res.status).toBe(200)
      await res.text()

      expect('askQuestions' in prewriterTools()).toBe(true)
    })

    it('lets the prewriter ask again on a later round (multi-round loop)', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', clarifyBeforeGenerate: true }))
      // Round 1: the prewriter asks a second time after the first answer.
      mockAgentStream.mockImplementation(async () => {
        const tools = lastAgentTools() as { askQuestions?: { execute: (a: unknown) => Promise<unknown> } }
        if (tools.askQuestions) {
          await tools.askQuestions.execute({ questions: [{ ...SAMPLE_QUESTION, question: 'And the tone?', header: 'Tone' }] })
        }
        return createMockStreamResult('') as never
      })

      const res = await generate({
        input: 'Continue',
        saveResult: true,
        clarifyRound: 1,
        clarifications: [{ question: 'Whose POV?', answer: 'Alice' }],
      })
      const events = await parseNDJSON(res)

      const clarify = events.find((e) => e.type === 'clarify-questions') as { questions: Array<{ question: string }>; round: number } | undefined
      expect(clarify).toBeDefined()
      expect(clarify!.round).toBe(1)
      expect(clarify!.questions[0].question).toContain('tone')
      // Still no prose written, no second agent constructed.
      expect(events.some((e) => e.type === 'text')).toBe(false)
      expect(mockAgentCtor).toHaveBeenCalledTimes(1)
    })

    it('renders every prior clarification into the prewriter prompt', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', clarifyBeforeGenerate: true }))
      let n = 0
      mockAgentStream.mockImplementation(() => { n++; return createMockStreamResult(n === 1 ? 'Brief.' : 'Prose.') as never })

      await generate({
        input: 'Continue',
        saveResult: false,
        clarifyRound: 1,
        clarifications: [
          { question: 'Whose POV?', answer: 'Alice' },
          { question: 'What tone?', answer: 'Somber' },
        ],
      }).then((r) => r.text())

      const prewriterArgs = mockAgentStream.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> }
      const text = prewriterArgs.messages.map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n')
      expect(text).toContain('Alice')
      expect(text).toContain('Somber')
      expect(text).toContain('Whose POV?')
      expect(text).toContain('What tone?')
    })

    it('supports the ask tool in regenerate mode', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', clarifyBeforeGenerate: true }))
      await createFragment(dataDir, storyId, makeProseFragment('pr-existing'))

      mockAgentStream.mockImplementation(async () => {
        const tools = lastAgentTools() as { askQuestions?: { execute: (a: unknown) => Promise<unknown> } }
        if (tools.askQuestions) await tools.askQuestions.execute({ questions: [SAMPLE_QUESTION] })
        return createMockStreamResult('') as never
      })

      const res = await generate({ input: 'Try again', mode: 'regenerate', fragmentId: 'pr-existing', saveResult: true })
      expect(res.status).toBe(200)
      const events = await parseNDJSON(res)

      expect('askQuestions' in prewriterTools()).toBe(true)
      expect(events.some((e) => e.type === 'clarify-questions')).toBe(true)
    })
  })
})
