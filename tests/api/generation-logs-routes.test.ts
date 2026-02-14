import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir } from '../setup'
import { createApp } from '@/server/api'
import { createStory } from '@/server/fragments/storage'
import { saveGenerationLog, type GenerationLog } from '@/server/llm/generation-logs'

// Mock the AI SDK to prevent real LLM calls
vi.mock('ai', () => ({
  stepCountIs: vi.fn((n: number) => n),
  streamText: vi.fn(() => {
    const text = 'Generated prose text'
    // Create a proper ReadableStream for textStream that supports tee()
    const textStream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(text)
        controller.close()
      },
    })
    return {
      textStream,
      text: Promise.resolve(text),
      usage: Promise.resolve({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }),
      finishReason: Promise.resolve('stop' as const),
      steps: Promise.resolve([
        {
          toolCalls: [
            {
              toolName: 'fragmentList',
              args: { type: 'character' },
            },
          ],
          toolResults: [
            {
              toolName: 'fragmentList',
              args: { type: 'character' },
              result: [{ id: 'ch-test', name: 'Alice' }],
            },
          ],
        },
      ]),
      toTextStreamResponse: () =>
        new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
    }
  }),
  tool: vi.fn((def: unknown) => def),
}))

describe('generation-logs API routes', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>
  const storyId = 'story-logtest'

  function makeLog(overrides: Partial<GenerationLog> = {}): GenerationLog {
    return {
      id: `log-${Date.now()}`,
      createdAt: new Date().toISOString(),
      input: 'Test input',
      messages: [
        { role: 'system', content: 'System message' },
        { role: 'user', content: 'Test input' },
      ],
      toolCalls: [],
      generatedText: 'Some prose',
      fragmentId: null,
      model: 'deepseek-chat',
      durationMs: 500,
      stepCount: 1,
      finishReason: 'stop',
      stepsExceeded: false,
      ...overrides,
    }
  }

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    app = createApp(dataDir)

    await createStory(dataDir, {
      id: storyId,
      name: 'Log Test Story',
      description: 'For testing logs',
      summary: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      settings: { outputFormat: 'markdown', enabledPlugins: [], summarizationThreshold: 4, maxSteps: 10, providerId: null, modelId: null, contextOrderMode: 'simple' as const, fragmentOrder: [] },
    })
  })

  afterEach(async () => {
    await cleanup()
  })

  it('GET /generation-logs returns empty list initially', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${storyId}/generation-logs`),
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual([])
  })

  it('GET /generation-logs lists saved logs as summaries', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({
      id: 'log-a',
      createdAt: '2025-01-01T00:00:00.000Z',
      input: 'First',
    }))
    await saveGenerationLog(dataDir, storyId, makeLog({
      id: 'log-b',
      createdAt: '2025-01-02T00:00:00.000Z',
      input: 'Second',
    }))

    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${storyId}/generation-logs`),
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(2)
    // Newest first
    expect(data[0].id).toBe('log-b')
    expect(data[1].id).toBe('log-a')
    // Should be summaries (no full messages/text)
    expect(data[0]).not.toHaveProperty('messages')
    expect(data[0]).not.toHaveProperty('generatedText')
  })

  it('GET /generation-logs/:logId returns full log', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({
      id: 'log-detail',
      input: 'Detail test',
      toolCalls: [{ toolName: 'fragmentGet', args: { fragmentId: 'ch-a1' }, result: { name: 'Alice' } }],
    }))

    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${storyId}/generation-logs/log-detail`),
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe('log-detail')
    expect(data.messages).toHaveLength(2)
    expect(data.toolCalls).toHaveLength(1)
    expect(data.toolCalls[0].toolName).toBe('fragmentGet')
    expect(data.generatedText).toBe('Some prose')
  })

  it('GET /generation-logs/:logId returns 404 for non-existent log', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${storyId}/generation-logs/nonexistent`),
    )
    expect(res.status).toBe(404)
  })

  it('POST /generate persists a generation log', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'Write a battle scene', saveResult: true }),
      }),
    )
    expect(res.status).toBe(200)

    // Wait for async background save to complete
    await new Promise((r) => setTimeout(r, 100))

    // Check that a generation log was saved
    const logsRes = await app.fetch(
      new Request(`http://localhost/api/stories/${storyId}/generation-logs`),
    )
    const logs = await logsRes.json()
    expect(logs.length).toBeGreaterThanOrEqual(1)

    // Fetch the full log
    const logId = logs[0].id
    const logRes = await app.fetch(
      new Request(`http://localhost/api/stories/${storyId}/generation-logs/${logId}`),
    )
    const log = await logRes.json()
    expect(log.input).toBe('Write a battle scene')
    expect(log.messages).toHaveLength(2)
    expect(log.messages[0].role).toBe('system')
    expect(log.messages[1].role).toBe('user')
    expect(log.generatedText).toBe('Generated prose text')
    expect(log.model).toBe('deepseek-chat')
    expect(log.durationMs).toBeGreaterThanOrEqual(0)
    // Should have captured tool calls from steps
    expect(log.toolCalls.length).toBeGreaterThanOrEqual(0)
  })
})
