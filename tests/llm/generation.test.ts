import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir } from '../setup'
import {
  createStory,
  createFragment,
  getFragment,
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
    const msg = callArgs.messages!.find((m: any) => m.role === 'user')
    expect(msg!.content).toContain('Dark gothic style.')
    expect(msg!.content).toContain('Continue the story')
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
    expect(callArgs.tools).toHaveProperty('getCharacter')
    expect(callArgs.tools).toHaveProperty('listCharacters')
    expect(callArgs.tools).toHaveProperty('listFragmentTypes')
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

  // --- Regenerate mode ---

  it('regenerate mode replaces fragment content and stores previousContent', async () => {
    const original = makeFragment({
      id: 'pr-regen',
      content: 'Original prose content.',
    })
    await createFragment(dataDir, storyId, original)

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Regenerated prose content.') as any,
    )

    const res = await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Take a different direction',
        saveResult: true,
        mode: 'regenerate',
        fragmentId: 'pr-regen',
      }),
    })

    expect(res.status).toBe(200)
    await res.text()
    await new Promise((r) => setTimeout(r, 100))

    const updated = await getFragment(dataDir, storyId, 'pr-regen')
    expect(updated).toBeDefined()
    expect(updated!.content).toBe('Regenerated prose content.')
    expect(updated!.meta.previousContent).toBe('Original prose content.')
    expect(updated!.meta.generationMode).toBe('regenerate')

    // Should NOT create a new fragment
    const fragments = await listFragments(dataDir, storyId, 'prose')
    expect(fragments.filter((f) => f.id === 'pr-regen').length).toBe(1)
  })

  // --- Refine mode ---

  it('refine mode includes existing content in prompt and replaces fragment', async () => {
    const original = makeFragment({
      id: 'pr-refine',
      content: 'The hero walked slowly through the forest.',
    })
    await createFragment(dataDir, storyId, original)

    mockedStreamText.mockReturnValue(
      createMockStreamResult('The hero crept through the dark forest.') as any,
    )

    const res = await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Make it more suspenseful',
        saveResult: true,
        mode: 'refine',
        fragmentId: 'pr-refine',
      }),
    })

    expect(res.status).toBe(200)
    await res.text()
    await new Promise((r) => setTimeout(r, 100))

    // Verify the prompt included existing content
    const callArgs = mockedStreamText.mock.calls[0][0]
    const userMsg = callArgs.messages!.find((m: any) => m.role === 'user')
    expect(userMsg!.content).toContain('The hero walked slowly through the forest.')
    expect(userMsg!.content).toContain('Make it more suspenseful')

    // Verify fragment was updated in-place
    const updated = await getFragment(dataDir, storyId, 'pr-refine')
    expect(updated!.content).toBe('The hero crept through the dark forest.')
    expect(updated!.meta.previousContent).toBe('The hero walked slowly through the forest.')
    expect(updated!.meta.generationMode).toBe('refine')
  })

  // --- Validation ---

  it('returns 422 when mode=regenerate but fragmentId is missing', async () => {
    const res = await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Regenerate this',
        saveResult: true,
        mode: 'regenerate',
      }),
    })

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('fragmentId')
  })

  it('returns 404 when mode=regenerate with nonexistent fragment', async () => {
    mockedStreamText.mockReturnValue(
      createMockStreamResult('test') as any,
    )

    const res = await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Regenerate this',
        saveResult: true,
        mode: 'regenerate',
        fragmentId: 'pr-nonexistent',
      }),
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('Fragment not found')
  })

  // --- Revert endpoint ---

  it('POST /stories/:storyId/fragments/:fragmentId/revert restores previousContent', async () => {
    const fragment = makeFragment({
      id: 'pr-revert',
      content: 'New content after regenerate.',
      meta: { previousContent: 'Original content before regenerate.' },
    })
    await createFragment(dataDir, storyId, fragment)

    const res = await api(`/stories/${storyId}/fragments/pr-revert/revert`, {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content).toBe('Original content before regenerate.')

    // Verify on disk
    const reverted = await getFragment(dataDir, storyId, 'pr-revert')
    expect(reverted!.content).toBe('Original content before regenerate.')
    expect(reverted!.meta.previousContent).toBeUndefined()
  })

  it('POST /stories/:storyId/fragments/:fragmentId/revert returns 422 when no previousContent', async () => {
    const fragment = makeFragment({
      id: 'pr-norevert',
      content: 'Some content.',
      meta: {},
    })
    await createFragment(dataDir, storyId, fragment)

    const res = await api(`/stories/${storyId}/fragments/pr-norevert/revert`, {
      method: 'POST',
    })

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('No previous content')
  })

  it('POST /stories/:storyId/fragments/:fragmentId/revert returns 404 for nonexistent fragment', async () => {
    const res = await api(`/stories/${storyId}/fragments/pr-ghost/revert`, {
      method: 'POST',
    })

    expect(res.status).toBe(404)
  })
})
