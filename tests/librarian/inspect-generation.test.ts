import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory, createFragment } from '@/server/fragments/storage'
import { saveGenerationLog, findGenerationLogByFragment, type GenerationLog } from '@/server/llm/generation-logs'
import { formatGenerationInspection, inspectGenerationForFragment } from '@/server/librarian/inspect-generation'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

const storyId = 'story-inspect'
const now = '2025-01-01T00:00:00.000Z'

function makeStory(): StoryMeta {
  return { id: storyId, name: 'S', description: '', coverImage: null, summary: '', createdAt: now, updatedAt: now, settings: makeTestSettings() }
}

function makeFragment(id: string): Fragment {
  return { id, type: 'prose', name: `Fragment ${id}`, description: '', content: 'Prose body', tags: [], refs: [], sticky: false, placement: 'user', createdAt: now, updatedAt: now, order: 0, meta: {}, archived: false }
}

let counter = 0
function makeLog(overrides: Partial<GenerationLog> = {}): GenerationLog {
  return {
    id: `log-${counter++}`,
    createdAt: now,
    input: 'Write a battle scene',
    messages: [
      { role: 'system', content: 'SYSTEM INSTRUCTIONS' },
      { role: 'user', content: 'USER CONTEXT BLOCK' },
    ],
    toolCalls: [],
    generatedText: 'The blades met in a shower of sparks.',
    fragmentId: null,
    model: 'test-model',
    durationMs: 500,
    stepCount: 1,
    finishReason: 'stop',
    stepsExceeded: false,
    ...overrides,
  }
}

describe('findGenerationLogByFragment', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await createStory(dataDir, makeStory())
  })
  afterEach(async () => { await cleanup() })

  it('returns null when no log matches', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({ id: 'other', fragmentId: 'pr-zzz' }))
    expect(await findGenerationLogByFragment(dataDir, storyId, 'pr-abc')).toBeNull()
  })

  it('returns the most recent log for the fragment', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({ id: 'old', fragmentId: 'pr-abc', createdAt: '2025-01-01T00:00:00.000Z', input: 'old' }))
    await saveGenerationLog(dataDir, storyId, makeLog({ id: 'new', fragmentId: 'pr-abc', createdAt: '2025-02-01T00:00:00.000Z', input: 'new' }))
    await saveGenerationLog(dataDir, storyId, makeLog({ id: 'unrelated', fragmentId: 'pr-other', createdAt: '2025-03-01T00:00:00.000Z' }))
    const log = await findGenerationLogByFragment(dataDir, storyId, 'pr-abc')
    expect(log?.id).toBe('new')
    expect(log?.input).toBe('new')
  })
})

describe('inspectGenerationForFragment', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment('pr-abc'))
  })
  afterEach(async () => { await cleanup() })

  it('errors when the fragment does not exist', async () => {
    const res = await inspectGenerationForFragment(dataDir, storyId, 'pr-missing')
    expect(res.error).toMatch(/not found/i)
  })

  it('errors when the fragment exists but was never generated', async () => {
    const res = await inspectGenerationForFragment(dataDir, storyId, 'pr-abc')
    expect(res.error).toMatch(/No generation log/i)
  })

  it('returns a summary overview by default', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({
      fragmentId: 'pr-abc',
      toolCalls: [{ toolName: 'getFragment', args: { id: 'ch-a' }, result: { name: 'Alice' } }],
      totalUsage: { inputTokens: 100, outputTokens: 50 },
    }))
    const res = await inspectGenerationForFragment(dataDir, storyId, 'pr-abc')
    expect(res.model).toBe('test-model')
    expect(res.input).toBe('Write a battle scene')
    expect(res.toolsCalled).toEqual(['getFragment'])
    expect(res.tokens).toEqual({ inputTokens: 100, outputTokens: 50 })
    expect(res.generatedPreview).toContain('blades met')
    // The full prompt is NOT dumped in the summary view.
    expect(res).not.toHaveProperty('prompt')
  })

  it('returns the assembled prompt for aspect=prompt', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({ fragmentId: 'pr-abc' }))
    const res = await inspectGenerationForFragment(dataDir, storyId, 'pr-abc', 'prompt') as any
    expect(res.prompt.system).toBe('SYSTEM INSTRUCTIONS')
    expect(res.prompt.user).toBe('USER CONTEXT BLOCK')
  })

  it('returns tool calls for aspect=tools', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({
      fragmentId: 'pr-abc',
      toolCalls: [{ toolName: 'searchFragments', args: { query: 'sword' }, result: ['kn-sword'] }],
    }))
    const res = await inspectGenerationForFragment(dataDir, storyId, 'pr-abc', 'tools') as any
    expect(res.toolCallCount).toBe(1)
    expect(res.toolCalls[0].toolName).toBe('searchFragments')
    expect(res.toolCalls[0].args).toEqual({ query: 'sword' })
  })

  it('surfaces the prewriter brief for aspect=prewriter', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({
      fragmentId: 'pr-abc',
      prewriterBrief: 'Beat 1: tension rises.',
      prewriterModel: 'planner-model',
      prewriterDirections: [{ pacing: 'slow', title: 'Linger', description: 'd', instruction: 'i' }],
    }))
    const res = await inspectGenerationForFragment(dataDir, storyId, 'pr-abc', 'prewriter') as any
    expect(res.prewriter.brief).toBe('Beat 1: tension rises.')
    expect(res.prewriter.model).toBe('planner-model')
    expect(res.prewriter.directions).toHaveLength(1)
  })

  it('notes when prewriter mode was not used', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({ fragmentId: 'pr-abc' }))
    const res = await inspectGenerationForFragment(dataDir, storyId, 'pr-abc', 'prewriter') as any
    expect(res.prewriter).toBeNull()
    expect(res.note).toMatch(/not.*prewriter/i)
  })

  it('returns reasoning for aspect=reasoning', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({ fragmentId: 'pr-abc', reasoning: 'I considered the stakes.' }))
    const res = await inspectGenerationForFragment(dataDir, storyId, 'pr-abc', 'reasoning') as any
    expect(res.reasoning).toBe('I considered the stakes.')
  })
})

describe('formatGenerationInspection', () => {
  it('truncates oversized fields with a marker', () => {
    const big = 'x'.repeat(20000)
    const res = formatGenerationInspection(makeLog({ messages: [{ role: 'system', content: big }, { role: 'user', content: 'u' }] }), 'prompt') as any
    expect(res.prompt.system).toContain('…[truncated')
    expect(res.prompt.system.length).toBeLessThan(big.length)
  })
})
