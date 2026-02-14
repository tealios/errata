import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir } from '../setup'
import {
  createStory,
  createFragment,
  listFragments,
} from '@/server/fragments/storage'
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

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: { outputFormat: 'markdown', enabledPlugins: [] },
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
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    ...overrides,
  }
}

function createMockStreamResult(text: string) {
  // Create a minimal mock that mimics the streamText result
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })

  return {
    textStream: (async function* () {
      yield text
    })(),
    text: Promise.resolve(text),
    usage: Promise.resolve({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }),
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

describe('generation endpoint', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>
  const storyId = 'story-test'

  async function api(path: string, init?: RequestInit) {
    const res = await app.fetch(
      new Request(`http://localhost/api${path}`, init),
    )
    return res
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

  it('POST /stories/:storyId/generate calls streamText with correct context', async () => {
    const guideline = makeFragment({
      id: 'gl-0001',
      type: 'guideline',
      name: 'Tone',
      description: 'Writing tone',
      content: 'Dark gothic style.',
      sticky: true,
    })
    await createFragment(dataDir, storyId, guideline)

    mockedStreamText.mockReturnValue(
      createMockStreamResult('The shadows deepened.') as any,
    )

    const res = await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Continue the story',
        saveResult: false,
      }),
    })

    expect(res.status).toBe(200)
    expect(mockedStreamText).toHaveBeenCalledTimes(1)

    // Verify streamText was called with correct messages
    const callArgs = mockedStreamText.mock.calls[0][0]
    expect(callArgs.messages).toBeDefined()
    const systemMsg = callArgs.messages!.find((m: any) => m.role === 'system')
    expect(systemMsg!.content).toContain('Dark gothic style.')
    const userMsg = callArgs.messages!.find((m: any) => m.role === 'user')
    expect(userMsg!.content).toContain('Continue the story')
  })

  it('POST /stories/:storyId/generate includes fragment tools', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('Generated text.') as any,
    )

    const res = await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Write something',
        saveResult: false,
      }),
    })

    expect(res.status).toBe(200)

    const callArgs = mockedStreamText.mock.calls[0][0]
    expect(callArgs.tools).toBeDefined()
    expect(callArgs.tools).toHaveProperty('fragmentGet')
    expect(callArgs.tools).toHaveProperty('fragmentList')
    expect(callArgs.tools).toHaveProperty('fragmentTypesList')
  })

  it('POST /stories/:storyId/generate saves result when saveResult=true', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('The dragon roared.') as any,
    )

    const res = await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Add a dragon scene',
        saveResult: true,
      }),
    })

    expect(res.status).toBe(200)

    // Wait for the text to be consumed from stream
    await res.text()

    // Give a moment for async save
    await new Promise((r) => setTimeout(r, 100))

    // Verify the generated prose was saved
    const fragments = await listFragments(dataDir, storyId, 'prose')
    expect(fragments.length).toBe(1)
    expect(fragments[0].content).toBe('The dragon roared.')
    expect(fragments[0].type).toBe('prose')
  })

  it('returns 404 for non-existent story', async () => {
    const res = await api('/stories/nonexistent/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Hello',
        saveResult: false,
      }),
    })

    expect(res.status).toBe(404)
  })

  it('returns 400 when input is empty', async () => {
    const res = await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: '',
        saveResult: false,
      }),
    })

    expect(res.status).toBe(422)
  })
})
