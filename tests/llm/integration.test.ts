import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir } from '../setup'
import {
  createStory,
  createFragment,
  listFragments,
  getStory,
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

function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-int',
    name: 'Integration Story',
    description: 'A story for integration tests',
    summary: 'An epic adventure begins.',
    createdAt: now,
    updatedAt: now,
    settings: { outputFormat: 'markdown', enabledPlugins: [] },
    ...overrides,
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
    toTextStreamResponse: () =>
      new Response(stream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    toUIMessageStreamResponse: () =>
      new Response(stream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
  }
}

describe('end-to-end generation integration', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>
  const storyId = 'story-int'

  async function api(path: string, init?: RequestInit) {
    return app.fetch(new Request(`http://localhost/api${path}`, init))
  }

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    app = createApp(dataDir)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await cleanup()
  })

  it('full pipeline: create story + fragments → generate → verify saved prose', async () => {
    // Step 1: Create story via API
    const storyRes = await api('/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Epic Tale', description: 'An epic story' }),
    })
    expect(storyRes.status).toBe(200)
    const story = (await storyRes.json()) as StoryMeta
    const sid = story.id

    // Step 2: Create a guideline (sticky)
    const glRes = await api(`/stories/${sid}/fragments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'guideline',
        name: 'Style Guide',
        description: 'Writing style rules',
        content: 'Write in first person, present tense.',
      }),
    })
    expect(glRes.status).toBe(200)

    // Step 3: Create a character
    const chRes = await api(`/stories/${sid}/fragments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'character',
        name: 'Elena',
        description: 'The protagonist',
        content: 'Elena is a brave warrior with a mysterious past.',
      }),
    })
    expect(chRes.status).toBe(200)

    // Step 4: Create initial prose
    const prRes = await api(`/stories/${sid}/fragments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'prose',
        name: 'Opening',
        description: 'The story begins',
        content: 'I wake up to the sound of distant thunder.',
      }),
    })
    expect(prRes.status).toBe(200)

    // Step 5: Mock the LLM to return generated text
    const generatedText =
      'I reach for my sword, the cold metal sending a jolt through my fingers. The thunder grows louder.'
    mockedStreamText.mockReturnValue(createMockStreamResult(generatedText) as any)

    // Step 6: Call generate with saveResult=true
    const genRes = await api(`/stories/${sid}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Elena hears danger approaching and prepares for battle.',
        saveResult: true,
      }),
    })
    expect(genRes.status).toBe(200)

    // Consume the response
    const responseText = await genRes.text()
    expect(responseText).toBe(generatedText)

    // Wait for async save
    await new Promise((r) => setTimeout(r, 100))

    // Step 7: Verify streamText was called with correct context
    expect(mockedStreamText).toHaveBeenCalledTimes(1)
    const callArgs = mockedStreamText.mock.calls[0][0]

    // Should have messages (system + user)
    expect(callArgs.messages).toBeDefined()
    expect(callArgs.messages!.length).toBe(2)

    const systemMsg = callArgs.messages![0]
    expect(systemMsg.role).toBe('system')
    // System should contain the story name
    expect(systemMsg.content).toContain('Epic Tale')
    // System should contain the existing prose
    expect(systemMsg.content).toContain('I wake up to the sound of distant thunder.')
    // System should mention fragment tools
    expect(systemMsg.content).toContain('fragmentGet')

    const userMsg = callArgs.messages![1]
    expect(userMsg.role).toBe('user')
    expect(userMsg.content).toContain('Elena hears danger approaching')

    // Should have tools
    expect(callArgs.tools).toHaveProperty('fragmentGet')
    expect(callArgs.tools).toHaveProperty('fragmentList')
    expect(callArgs.tools).toHaveProperty('fragmentSet')
    expect(callArgs.tools).toHaveProperty('fragmentEdit')
    expect(callArgs.tools).toHaveProperty('fragmentDelete')
    expect(callArgs.tools).toHaveProperty('fragmentTypesList')

    // Step 8: Verify the generated prose was saved as a fragment
    const proseFragments = await listFragments(dataDir, sid, 'prose')
    expect(proseFragments.length).toBe(2) // original + generated

    const generatedFragment = proseFragments.find(
      (f) => f.content === generatedText,
    )
    expect(generatedFragment).toBeDefined()
    expect(generatedFragment!.type).toBe('prose')
    expect(generatedFragment!.id).toMatch(/^pr-/)
    expect(generatedFragment!.meta).toHaveProperty('generatedFrom')
  })

  it('generation without save does not create fragments', async () => {
    // Create story
    const storyRes = await api('/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Preview Story', description: 'Testing preview' }),
    })
    const story = (await storyRes.json()) as StoryMeta
    const sid = story.id

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Preview text only.') as any,
    )

    const genRes = await api(`/stories/${sid}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Generate a preview',
        saveResult: false,
      }),
    })
    expect(genRes.status).toBe(200)
    await genRes.text()

    // Wait and verify no fragments were saved
    await new Promise((r) => setTimeout(r, 100))
    const fragments = await listFragments(dataDir, sid, 'prose')
    expect(fragments.length).toBe(0)
  })

  it('context includes sticky guidelines but not non-sticky ones in full', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    // Sticky guideline - should appear in full
    await createFragment(dataDir, storyId, makeFragment({
      id: 'gl-0001',
      type: 'guideline',
      name: 'Core Rules',
      description: 'Main writing rules',
      content: 'Never break the fourth wall.',
      sticky: true,
    }))

    // Non-sticky guideline - should appear only as shortlist
    await createFragment(dataDir, storyId, makeFragment({
      id: 'gl-0002',
      type: 'guideline',
      name: 'Optional Rule',
      description: 'Optional writing advice',
      content: 'Consider using metaphors sparingly.',
      sticky: false,
    }))

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Test output.') as any,
    )

    const genRes = await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Continue', saveResult: false }),
    })
    expect(genRes.status).toBe(200)
    await genRes.text()

    const systemContent = mockedStreamText.mock.calls[0][0].messages![0].content as string

    // Sticky guideline content should be in full
    expect(systemContent).toContain('Never break the fourth wall.')

    // Non-sticky should be in shortlist (id + description) but NOT full content
    expect(systemContent).toContain('gl-0002')
    expect(systemContent).toContain('Optional writing advice')
    expect(systemContent).not.toContain('Consider using metaphors sparingly.')
  })
})
