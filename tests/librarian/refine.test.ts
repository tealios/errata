import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir } from '../setup'
import {
  createStory,
  createFragment,
  getFragment,
} from '@/server/fragments/storage'
import { initProseChain, addProseSection } from '@/server/fragments/prose-chain'
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
      maxSteps: 5,
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

  return {
    textStream,
    text: Promise.resolve(text),
    usage: Promise.resolve({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }),
    finishReason: Promise.resolve('stop' as const),
    steps: Promise.resolve([]),
    toTextStreamResponse: () => new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
  }
}

describe('librarian refine endpoint', () => {
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
    const res = await api('/stories/nonexistent/librarian/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fragmentId: 'ch-0001' }),
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('Story not found')
  })

  it('returns 404 when fragment does not exist', async () => {
    const res = await api(`/stories/${storyId}/librarian/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fragmentId: 'ch-missing' }),
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('Fragment not found')
  })

  it('rejects prose fragments with 422', async () => {
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      type: 'prose',
      name: 'Test Prose',
      description: 'A prose fragment',
      content: 'Some prose text.',
    }))

    const res = await api(`/stories/${storyId}/librarian/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fragmentId: 'pr-0001' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('prose')
  })

  it('streams refinement text for a character fragment', async () => {
    await createFragment(dataDir, storyId, makeFragment({
      id: 'ch-0001',
      type: 'character',
      name: 'Alice',
      description: 'The protagonist',
      content: 'Alice is a brave warrior.',
    }))

    mockedStreamText.mockReturnValue(
      createMockStreamResult('I updated Alice\'s description to reflect recent events.') as any,
    )

    const res = await api(`/stories/${storyId}/librarian/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fragmentId: 'ch-0001',
        instructions: 'Update based on recent events',
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')

    const text = await res.text()
    expect(text).toContain('updated')
  })

  it('calls streamText with write-enabled tools', async () => {
    await createFragment(dataDir, storyId, makeFragment({
      id: 'ch-0001',
      type: 'character',
      name: 'Alice',
    }))

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Done.') as any,
    )

    await api(`/stories/${storyId}/librarian/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fragmentId: 'ch-0001' }),
    })

    expect(mockedStreamText).toHaveBeenCalledTimes(1)
    const callArgs = mockedStreamText.mock.calls[0][0] as any

    // Should have write tools
    expect(callArgs.tools).toBeDefined()
    expect(callArgs.tools.updateFragment).toBeDefined()
    expect(callArgs.tools.editFragment).toBeDefined()
    expect(callArgs.tools.deleteFragment).toBeDefined()
  })

  it('includes refinement system prompt', async () => {
    await createFragment(dataDir, storyId, makeFragment({
      id: 'ch-0001',
      type: 'character',
      name: 'Alice',
    }))

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Done.') as any,
    )

    await api(`/stories/${storyId}/librarian/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fragmentId: 'ch-0001' }),
    })

    const callArgs = mockedStreamText.mock.calls[0][0] as any
    expect(callArgs.system).toContain('fragment refinement agent')
    expect(callArgs.system).toContain('updateFragment')
  })

  it('includes story context in messages', async () => {
    // Create a prose fragment for context
    const prose = makeFragment({
      id: 'pr-0001',
      type: 'prose',
      name: 'Prose 1',
      description: 'Opening',
      content: 'The hero entered the dark forest.',
    })
    await createFragment(dataDir, storyId, prose)
    await initProseChain(dataDir, storyId, 'pr-0001')

    await createFragment(dataDir, storyId, makeFragment({
      id: 'ch-0001',
      type: 'character',
      name: 'Alice',
    }))

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Done.') as any,
    )

    await api(`/stories/${storyId}/librarian/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fragmentId: 'ch-0001',
        instructions: 'Update based on forest scene',
      }),
    })

    const callArgs = mockedStreamText.mock.calls[0][0] as any
    const userMessage = callArgs.messages[0].content
    expect(userMessage).toContain('Test Story')
    expect(userMessage).toContain('ch-0001')
    expect(userMessage).toContain('Update based on forest scene')
  })

  it('works without instructions (autonomous mode)', async () => {
    await createFragment(dataDir, storyId, makeFragment({
      id: 'kn-0001',
      type: 'knowledge',
      name: 'Forest Lore',
      description: 'Knowledge about forests',
      content: 'The dark forest is ancient.',
    }))

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Improved the knowledge fragment.') as any,
    )

    const res = await api(`/stories/${storyId}/librarian/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fragmentId: 'kn-0001' }),
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Improved')

    // Check that the message includes autonomous improvement instruction
    const callArgs = mockedStreamText.mock.calls[0][0] as any
    const userMessage = callArgs.messages[0].content
    expect(userMessage).toContain('No specific instructions')
  })

  it('works with guideline fragments', async () => {
    await createFragment(dataDir, storyId, makeFragment({
      id: 'gl-0001',
      type: 'guideline',
      name: 'Tone',
      description: 'Writing tone guide',
      content: 'Use a dark, gothic tone.',
    }))

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Refined the tone guideline.') as any,
    )

    const res = await api(`/stories/${storyId}/librarian/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fragmentId: 'gl-0001',
        instructions: 'Make it more specific',
      }),
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Refined')
  })
})
