import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the agent runner
const mockInvokeAgent = vi.fn()
vi.mock('@/server/agents', () => ({
  invokeAgent: (...args: unknown[]) => mockInvokeAgent(...args),
}))

import { createTempDir, makeTestSettings } from '../setup'
import {
  createStory,
  createFragment,
} from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'
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
    settings: makeTestSettings({ maxSteps: 5 }),
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

function createMockStreamResult(text: string) {
  const textStream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue(text)
      controller.close()
    },
  })

  const completion = Promise.resolve({
    text,
    toolCalls: [] as Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>,
    stepCount: 0,
    finishReason: 'stop',
  })

  return {
    textStream,
    completion,
  }
}

describe('librarian refine endpoint', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    app = createApp(dataDir)
    mockInvokeAgent.mockClear()
  })

  afterEach(async () => {
    await cleanup()
  })

  it('streams refinement text for a character fragment', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const fragment = makeFragment({
      type: 'character',
      id: 'ch-refine',
      name: 'Bob',
      content: 'Bob is a blacksmith.',
    })
    await createFragment(dataDir, story.id, fragment)

    const refinedText = 'Bob is a master blacksmith with a mysterious past.'
    const { textStream, completion } = createMockStreamResult(refinedText)
    mockInvokeAgent.mockResolvedValue({
      output: { textStream, completion },
      trace: [],
    })

    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fragmentId: fragment.id,
          instructions: 'Make Bob more interesting',
        }),
      }),
    )

    expect(res.status).toBe(200)

    const responseText = await res.text()
    expect(responseText).toBe(refinedText)
  })

  it('calls streamText with write-enabled tools', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const fragment = makeFragment({ type: 'guideline', id: 'gl-refine', name: 'Tone' })
    await createFragment(dataDir, story.id, fragment)

    mockInvokeAgent.mockReturnValue(createMockStreamResult('Updated guideline'))

    await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fragmentId: fragment.id,
          instructions: 'Update the tone',
        }),
      }),
    )

    expect(mockInvokeAgent).toHaveBeenCalled()
    const callArgs = mockInvokeAgent.mock.calls[0][0]
    expect(callArgs.agentName).toBe('librarian.refine')
  })

  it('includes refinement system prompt', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const fragment = makeFragment({ type: 'character', id: 'ch-refine2', name: 'Eve' })
    await createFragment(dataDir, story.id, fragment)

    mockInvokeAgent.mockReturnValue(createMockStreamResult('Refined'))

    await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fragmentId: fragment.id,
          instructions: 'Refine Eve',
        }),
      }),
    )

    expect(mockInvokeAgent).toHaveBeenCalled()
    const callArgs = mockInvokeAgent.mock.calls[0][0]
    expect(callArgs.input.instructions).toContain('Refine')
  })

  it('includes story context in messages', async () => {
    const story = makeStory({ summary: 'Epic quest' })
    await createStory(dataDir, story)

    // Use a character fragment instead of prose (prose can't be refined via this endpoint)
    const character = makeFragment({ type: 'character', id: 'ch-refine', name: 'Hero', content: 'A brave warrior' })
    await createFragment(dataDir, story.id, character)

    const { textStream, completion } = createMockStreamResult('Refined character')
    mockInvokeAgent.mockResolvedValue({
      output: { textStream, completion },
      trace: [],
    })

    await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fragmentId: character.id,
          instructions: 'Improve the character',
        }),
      }),
    )

    expect(mockInvokeAgent).toHaveBeenCalled()
    const callArgs = mockInvokeAgent.mock.calls[0][0]
    expect(callArgs.storyId).toBe(story.id)
    expect(callArgs.input.fragmentId).toBe(character.id)
  })

  it('works without instructions (autonomous mode)', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const fragment = makeFragment({ type: 'knowledge', id: 'kn-refine', name: 'Magic' })
    await createFragment(dataDir, story.id, fragment)

    const { textStream, completion } = createMockStreamResult('Improved knowledge')
    mockInvokeAgent.mockResolvedValue({
      output: { textStream, completion },
      trace: [],
    })

    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fragmentId: fragment.id,
        }),
      }),
    )

    expect(res.status).toBe(200)
  })

  it('works with guideline fragments', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const fragment = makeFragment({
      type: 'guideline',
      id: 'gl-refine',
      name: 'Style Guide',
      content: 'Always use active voice.',
    })
    await createFragment(dataDir, story.id, fragment)

    const { textStream: ts4, completion: c4 } = createMockStreamResult('Enhanced style guide')
    mockInvokeAgent.mockResolvedValue({
      output: { textStream: ts4, completion: c4 },
      trace: [],
    })

    const res = await app.fetch(
      new Request(`http://localhost/api/stories/${story.id}/librarian/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fragmentId: fragment.id,
          instructions: 'Make it more specific',
        }),
      }),
    )

    expect(res.status).toBe(200)
    const responseText = await res.text()
    expect(responseText).toBe('Enhanced style guide')
  })
})
