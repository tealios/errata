import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { join } from 'node:path'
import { writeFile, utimes } from 'node:fs/promises'
import { saveProseChain } from '@/server/fragments/prose-chain'
import { getContentRoot } from '@/server/fragments/branches'
import { createStory } from '@/server/fragments/storage'
import {
  saveGenerationLog,
  getGenerationLog,
  listGenerationLogs,
  findGenerationLogByFragment,
  pruneGenerationLogs,
  MAX_GENERATION_LOGS,
  type GenerationLog,
} from '@/server/llm/generation-logs'

describe('generation-logs storage', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-test1'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup

    await createStory(dataDir, {
      id: storyId,
      name: 'Test Story',
      description: 'A test',
    coverImage: null,
      summary: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      settings: makeTestSettings(),
    })
  })

  afterEach(async () => {
    await cleanup()
  })

  function makeLog(overrides: Partial<GenerationLog> = {}): GenerationLog {
    return {
      id: `log-${Date.now()}`,
      createdAt: new Date().toISOString(),
      input: 'Write the next scene',
      messages: [
        { role: 'system', content: 'You are a writing assistant.' },
        { role: 'user', content: 'Write the next scene' },
      ],
      toolCalls: [],
      generatedText: 'The sun set over the valley...',
      fragmentId: null,
      model: 'deepseek-chat',
      durationMs: 1500,
      stepCount: 1,
      finishReason: 'stop',
      stepsExceeded: false,
      ...overrides,
    }
  }

  it('saves and retrieves a generation log', async () => {
    const log = makeLog({ id: 'log-abc' })
    await saveGenerationLog(dataDir, storyId, log)

    const retrieved = await getGenerationLog(dataDir, storyId, 'log-abc')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe('log-abc')
    expect(retrieved!.input).toBe('Write the next scene')
    expect(retrieved!.generatedText).toBe('The sun set over the valley...')
    expect(retrieved!.model).toBe('deepseek-chat')
  })

  it('returns null for non-existent log', async () => {
    const result = await getGenerationLog(dataDir, storyId, 'nonexistent')
    expect(result).toBeNull()
  })

  it('lists generation logs sorted newest-first', async () => {
    const log1 = makeLog({ id: 'log-001', createdAt: '2025-01-01T00:00:00.000Z' })
    const log2 = makeLog({ id: 'log-002', createdAt: '2025-01-02T00:00:00.000Z' })
    const log3 = makeLog({ id: 'log-003', createdAt: '2025-01-03T00:00:00.000Z' })

    await saveGenerationLog(dataDir, storyId, log1)
    await saveGenerationLog(dataDir, storyId, log2)
    await saveGenerationLog(dataDir, storyId, log3)

    const logs = await listGenerationLogs(dataDir, storyId)
    expect(logs).toHaveLength(3)
    // Newest first
    expect(logs[0].id).toBe('log-003')
    expect(logs[1].id).toBe('log-002')
    expect(logs[2].id).toBe('log-001')
  })

  it('returns empty list when no logs exist', async () => {
    const logs = await listGenerationLogs(dataDir, storyId)
    expect(logs).toEqual([])
  })

  it('stores tool calls with args and results', async () => {
    const log = makeLog({
      id: 'log-tools',
      toolCalls: [
        {
          toolName: 'fragmentGet',
          args: { fragmentId: 'ch-a1b2' },
          result: { id: 'ch-a1b2', name: 'Alice', content: 'A detective' },
        },
        {
          toolName: 'fragmentList',
          args: { type: 'character' },
          result: [{ id: 'ch-a1b2', name: 'Alice' }],
        },
      ],
    })

    await saveGenerationLog(dataDir, storyId, log)
    const retrieved = await getGenerationLog(dataDir, storyId, 'log-tools')
    expect(retrieved!.toolCalls).toHaveLength(2)
    expect(retrieved!.toolCalls[0].toolName).toBe('fragmentGet')
    expect(retrieved!.toolCalls[0].args).toEqual({ fragmentId: 'ch-a1b2' })
    expect(retrieved!.toolCalls[1].toolName).toBe('fragmentList')
  })

  it('stores fragmentId link when generation was saved', async () => {
    const log = makeLog({ id: 'log-saved', fragmentId: 'pr-x1y2' })
    await saveGenerationLog(dataDir, storyId, log)

    const retrieved = await getGenerationLog(dataDir, storyId, 'log-saved')
    expect(retrieved!.fragmentId).toBe('pr-x1y2')
  })

  it('stores and surfaces stepsExceeded flag', async () => {
    const log = makeLog({
      id: 'log-exceeded',
      stepCount: 10,
      finishReason: 'tool-calls',
      stepsExceeded: true,
    })
    await saveGenerationLog(dataDir, storyId, log)

    const retrieved = await getGenerationLog(dataDir, storyId, 'log-exceeded')
    expect(retrieved!.stepsExceeded).toBe(true)
    expect(retrieved!.stepCount).toBe(10)
    expect(retrieved!.finishReason).toBe('tool-calls')

    const logs = await listGenerationLogs(dataDir, storyId)
    expect(logs[0].stepsExceeded).toBe(true)
    expect(logs[0].stepCount).toBe(10)
  })

  it('list returns summary without full messages/text', async () => {
    const log = makeLog({
      id: 'log-summary',
      input: 'A prompt',
      generatedText: 'A very long generated text...',
      toolCalls: [{ toolName: 'fragmentGet', args: {}, result: {} }],
    })
    await saveGenerationLog(dataDir, storyId, log)

    const logs = await listGenerationLogs(dataDir, storyId)
    expect(logs).toHaveLength(1)
    const summary = logs[0]
    expect(summary.id).toBe('log-summary')
    expect(summary.input).toBe('A prompt')
    expect(summary.model).toBe('deepseek-chat')
    expect(summary.durationMs).toBe(1500)
    expect(summary.toolCallCount).toBe(1)
    // Full details should not be in the list summary
    expect(summary).not.toHaveProperty('messages')
    expect(summary).not.toHaveProperty('generatedText')
    expect(summary).not.toHaveProperty('toolCalls')
  })

  it('skips corrupt log files when listing and searching', async () => {
    await saveGenerationLog(dataDir, storyId, makeLog({ id: 'log-good', fragmentId: 'pr-good' }))
    const dir = join(await getContentRoot(dataDir, storyId), 'generation-logs')
    await writeFile(join(dir, 'log-bad.json'), '{ truncated', 'utf-8')

    const list = await listGenerationLogs(dataDir, storyId)
    expect(list.map(l => l.id)).toEqual(['log-good'])
    expect((await findGenerationLogByFragment(dataDir, storyId, 'pr-good'))?.id).toBe('log-good')
  })

  describe('pruning', () => {
    async function saveAged(id: string, ageSec: number, overrides: Partial<GenerationLog> = {}) {
      await saveGenerationLog(dataDir, storyId, makeLog({ id, ...overrides }))
      const root = await getContentRoot(dataDir, storyId)
      const t = new Date(Date.now() - ageSec * 1000)
      await utimes(join(root, 'generation-logs', `${id}.json`), t, t)
    }

    it('deletes the oldest logs beyond the keep limit', async () => {
      for (let i = 0; i < 5; i++) await saveAged(`log-${i}`, 100 - i * 10)
      const removed = await pruneGenerationLogs(dataDir, storyId, 3)
      expect(removed).toBe(2)
      const ids = (await listGenerationLogs(dataDir, storyId)).map((l) => l.id).sort()
      expect(ids).toEqual(['log-2', 'log-3', 'log-4'])
    })

    it('keeps logs for fragments still active in the prose chain', async () => {
      await saveProseChain(dataDir, storyId, { entries: [{ proseFragments: ['pr-keep'], active: 'pr-keep' }] })
      await saveAged('log-old-active', 1000, { fragmentId: 'pr-keep' })
      await saveAged('log-old-other', 900, { fragmentId: 'pr-gone' })
      for (let i = 0; i < 3; i++) await saveAged(`log-new-${i}`, 10 - i)
      await pruneGenerationLogs(dataDir, storyId, 3)
      expect(await getGenerationLog(dataDir, storyId, 'log-old-active')).not.toBeNull()
      expect(await getGenerationLog(dataDir, storyId, 'log-old-other')).toBeNull()
    })

    it('prunes automatically on save and never throws', async () => {
      for (let i = 0; i < MAX_GENERATION_LOGS + 3; i++) {
        await saveGenerationLog(dataDir, storyId, makeLog({ id: `log-${String(i).padStart(4, '0')}` }))
      }
      expect((await listGenerationLogs(dataDir, storyId)).length).toBe(MAX_GENERATION_LOGS)
    }, 30000)
  })
})
