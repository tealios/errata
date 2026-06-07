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
      constructor(config: unknown) { mockAgentCtor(config) }
      stream(args: unknown) { return mockAgentStream(args) }
    },
  }
})

import { createApp } from '@/server/api'

function makeStory(overrides?: Partial<StoryMeta['settings']>): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: 'A summary.',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(overrides),
  }
}

function createMockStreamResult(text: string) {
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close() } })
  async function* gen() {
    yield { type: 'text-delta' as const, text }
    yield { type: 'finish' as const, finishReason: 'stop' }
  }
  return {
    textStream: new ReadableStream<string>({ start(c) { c.enqueue(text); c.close() } }),
    fullStream: gen(),
    text: Promise.resolve(text),
    usage: Promise.resolve({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }),
    totalUsage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
    finishReason: Promise.resolve('stop' as const),
    steps: Promise.resolve([]),
    toTextStreamResponse: () => new Response(stream),
    toUIMessageStreamResponse: () => new Response(stream),
  }
}

/** Join the prewriter (first agent) prompt messages into one string. */
function prewriterPromptText(): string {
  const args = mockAgentStream.mock.calls[0]?.[0] as { messages: Array<{ content: unknown }> }
  return args.messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n')
}

describe('prewriter reasoning length', () => {
  beforeAll(() => {
    ensureCoreAgentsRegistered()
  })

  it('defaults to normal', () => {
    const parsed = StoryMetaSchema.parse({
      id: 's', name: 'n', description: '', coverImage: null, summary: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    expect(parsed.settings.prewriterReasoning).toBe('normal')
  })

  describe('prompt directives', () => {
    let dataDir: string
    let cleanup: () => Promise<void>
    let app: ReturnType<typeof createApp>
    const storyId = 'story-test'

    async function generate() {
      return app.fetch(new Request(`http://localhost/api/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'Continue the story', saveResult: false }),
      }))
    }

    beforeEach(async () => {
      const tmp = await createTempDir()
      dataDir = tmp.path
      cleanup = tmp.cleanup
      await seedTestProvider(dataDir)
      app = createApp(dataDir)
      vi.clearAllMocks()
      let n = 0
      mockAgentStream.mockImplementation(() => {
        n++
        return createMockStreamResult(n === 1 ? 'A brief.' : 'Some prose.') as never
      })
    })

    afterEach(async () => {
      await cleanup()
    })

    it('injects the SHORT/speed directive when reasoning is short', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', prewriterReasoning: 'short' }))
      await (await generate()).text()
      const prompt = prewriterPromptText()
      expect(prompt).toContain('Reasoning Length: SHORT')
      expect(prompt).toContain('favor speed')
      expect(prompt).not.toContain('favor depth')
    })

    it('injects the NORMAL directive by default', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter' }))
      await (await generate()).text()
      const prompt = prewriterPromptText()
      expect(prompt).toContain('Reasoning Length: NORMAL')
      expect(prompt).not.toContain('favor speed')
      expect(prompt).not.toContain('favor depth')
    })

    it('injects the EXTENSIVE/depth directive when reasoning is extensive', async () => {
      await createStory(dataDir, makeStory({ generationMode: 'prewriter', prewriterReasoning: 'extensive' }))
      await (await generate()).text()
      const prompt = prewriterPromptText()
      expect(prompt).toContain('Reasoning Length: EXTENSIVE')
      expect(prompt).toContain('favor depth')
      expect(prompt).not.toContain('favor speed')
    })
  })
})
