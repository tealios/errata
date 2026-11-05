import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir, seedTestProvider, makeTestSettings } from '../setup'
import { createStory, createFragment } from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

const mockAgentStream = vi.fn()

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    ToolLoopAgent: class MockToolLoopAgent {
      constructor() {
        return { stream: mockAgentStream } as unknown as MockToolLoopAgent
      }
    },
  }
})

import { ensureCoreAgentsRegistered } from '@/server/agents'
import { refineFragment } from '@/server/librarian/refine'
import { optimizeCharacter } from '@/server/librarian/optimize-character'
import { transformProseSelection } from '@/server/librarian/prose-transform'
import { characterChat } from '@/server/character-chat/chat'

const storyId = 'story-test'

function makeFragment(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'pr-0001', type: 'prose', name: 'Scene', description: 'A scene',
    content: 'The guard moved quickly down the hall.', tags: [], refs: [],
    sticky: false, placement: 'user' as const, createdAt: now, updatedAt: now,
    order: 0, meta: {}, archived: false, ...overrides,
  }
}

/** A stream that never finishes on its own. */
function hangingStream() {
  return {
    fullStream: (async function* () {
      yield { type: 'text-delta', text: 'partial' }
      await new Promise(() => {})
    })(),
    totalUsage: Promise.resolve(undefined),
  }
}

describe('streaming agents abort the LLM call on cancel', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await seedTestProvider(dataDir)
    ensureCoreAgentsRegistered()
    mockAgentStream.mockReset()
    const now = new Date().toISOString()
    const story: StoryMeta = {
      id: storyId, name: 'T', description: '', coverImage: null, summary: '',
      createdAt: now, updatedAt: now, settings: makeTestSettings(),
    }
    await createStory(dataDir, story)
    await createFragment(dataDir, storyId, makeFragment({}))
    await createFragment(dataDir, storyId, makeFragment({ id: 'kn-0001', type: 'knowledge', name: 'Lore' }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'ch-0001', type: 'character', name: 'Hero' }))
  })

  afterEach(async () => { await cleanup() })

  async function expectAbortOnCancel(run: () => Promise<{ eventStream: ReadableStream<string> }>) {
    mockAgentStream.mockResolvedValue(hangingStream())
    const result = await run()
    const signal = mockAgentStream.mock.calls[0][0].abortSignal as AbortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    const reader = result.eventStream.getReader()
    await reader.read()
    await reader.cancel()
    expect(signal.aborted).toBe(true)
  }

  it('librarian.refine', () =>
    expectAbortOnCancel(() => refineFragment(dataDir, storyId, { fragmentId: 'kn-0001' })))

  it('librarian.optimize-character', () =>
    expectAbortOnCancel(() => optimizeCharacter(dataDir, storyId, { fragmentId: 'ch-0001' })))

  it('librarian.prose-transform', () =>
    expectAbortOnCancel(() => transformProseSelection(dataDir, storyId, {
      fragmentId: 'pr-0001', selectedText: 'The guard', operation: 'rewrite',
    })))

  it('character-chat.chat', () =>
    expectAbortOnCancel(() => characterChat(dataDir, storyId, {
      characterId: 'ch-0001', persona: { type: 'stranger' }, storyPointFragmentId: null,
      messages: [{ role: 'user', content: 'hi' }],
    })))
})
