import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir, seedTestProvider, makeTestSettings } from '../setup'
import {
  createStory,
  createFragment,
  updateFragment,
  listFragments,
  getFragment,
  migrateStoryToSummaryFragments,
} from '@/server/fragments/storage'
import { getAnalysis, listAnalyses } from '@/server/librarian/storage'
import { initProseChain, addProseSection } from '@/server/fragments/prose-chain'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

const { mockAgentStream } = vi.hoisted(() => ({
  mockAgentStream: vi.fn(),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    ToolLoopAgent: class {
      tools: Record<string, { execute: (args: unknown) => Promise<unknown> }>
      constructor(opts: { tools?: Record<string, unknown> } = {}) {
        this.tools = (opts.tools ?? {}) as Record<string, { execute: (args: unknown) => Promise<unknown> }>
      }
      async stream(args: unknown) {
        return mockAgentStream(args, this.tools)
      }
    },
  }
})

import { runLibrarian } from '@/server/librarian/agent'
import { ensureCoreAgentsRegistered } from '@/server/agents'

function makeStory(
  overrides: Omit<Partial<StoryMeta>, 'settings'> & { settings?: Partial<StoryMeta['settings']> } = {},
): StoryMeta {
  const now = new Date().toISOString()
  const defaultSettings: StoryMeta['settings'] = makeTestSettings({
    summarizationThreshold: 0,
  })
  const base: StoryMeta = {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings,
  }
  return {
    ...base,
    ...overrides,
    settings: { ...defaultSettings, ...(overrides.settings ?? {}) },
  }
}

function makeFragment(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'pr-0001',
    type: 'prose',
    name: 'Prose',
    description: '',
    content: 'Some prose content.',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user' as const,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    ...overrides,
  }
}

function mockSummary(summary: string) {
  mockAgentStream.mockImplementation(async (
    _args: unknown,
    tools: Record<string, { execute: (args: unknown) => Promise<unknown> }>,
  ) => ({
    fullStream: (async function* () {
      yield { type: 'tool-call' as const, toolCallId: 'call-0', toolName: 'updateSummary', input: { summary } }
      const output = await tools.updateSummary.execute({ summary })
      yield { type: 'tool-result' as const, toolCallId: 'call-0', toolName: 'updateSummary', output }
      yield { type: 'finish' as const, finishReason: 'stop' }
    })(),
  }))
}

async function setupChain(dataDir: string, storyId: string, ids: string[]) {
  if (ids.length === 0) return
  await initProseChain(dataDir, storyId, ids[0])
  for (let i = 1; i < ids.length; i++) {
    await addProseSection(dataDir, storyId, ids[i])
  }
}

describe('summary fragments', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-test'

  beforeEach(async () => {
    ensureCoreAgentsRegistered()
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await seedTestProvider(dataDir)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await cleanup()
  })

  // ── Append behavior ──────────────────────────────────────────

  it('appends two same-chapter analyses into a single summary fragment', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0002' }))
    await setupChain(dataDir, storyId, ['pr-0001', 'pr-0002'])

    mockSummary('First event.')
    await runLibrarian(dataDir, storyId, 'pr-0001')

    mockSummary('Second event.')
    await runLibrarian(dataDir, storyId, 'pr-0002')

    const summaries = await listFragments(dataDir, storyId, 'summary')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].content).toContain('First event.')
    expect(summaries[0].content).toContain('Second event.')
    expect(summaries[0].meta?.chapterId ?? null).toBeNull()
  })

  it('groups analyses under distinct chapter markers', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'mk-001', type: 'marker', name: 'Chapter One' }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'mk-002', type: 'marker', name: 'Chapter Two' }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0002' }))
    await setupChain(dataDir, storyId, ['mk-001', 'pr-0001', 'mk-002', 'pr-0002'])

    mockSummary('Events from chapter one.')
    await runLibrarian(dataDir, storyId, 'pr-0001')

    mockSummary('Events from chapter two.')
    await runLibrarian(dataDir, storyId, 'pr-0002')

    const summaries = await listFragments(dataDir, storyId, 'summary')
    expect(summaries).toHaveLength(2)
    const byChapter = new Map(summaries.map(s => [s.meta?.chapterId, s]))
    expect(byChapter.get('mk-001')?.content).toContain('Events from chapter one.')
    expect(byChapter.get('mk-002')?.content).toContain('Events from chapter two.')
    expect(byChapter.get('mk-001')?.name).toContain('Chapter One')
    expect(byChapter.get('mk-002')?.name).toContain('Chapter Two')
  })

  it('routes prose before the first marker into the Opening chapter (chapterId = null)', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'mk-001', type: 'marker', name: 'Chapter One' }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0002' }))
    await setupChain(dataDir, storyId, ['pr-0001', 'mk-001', 'pr-0002'])

    mockSummary('Pre-chapter event.')
    await runLibrarian(dataDir, storyId, 'pr-0001')

    mockSummary('Chapter one event.')
    await runLibrarian(dataDir, storyId, 'pr-0002')

    const summaries = await listFragments(dataDir, storyId, 'summary')
    const byChapter = new Map(summaries.map(s => [s.meta?.chapterId ?? null, s]))
    expect(byChapter.get(null)?.content).toContain('Pre-chapter event.')
    expect(byChapter.get('mk-001')?.content).toContain('Chapter one event.')
  })

  // ── Analysis linkage ─────────────────────────────────────────

  it('sets analysis.summaryFragmentId to the fragment that received the update', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupChain(dataDir, storyId, ['pr-0001'])

    mockSummary('Single event.')
    const analysis = await runLibrarian(dataDir, storyId, 'pr-0001')

    const summaries = await listFragments(dataDir, storyId, 'summary')
    expect(summaries).toHaveLength(1)
    const refetched = await getAnalysis(dataDir, storyId, analysis.id)
    expect(refetched?.summaryFragmentId).toBe(summaries[0].id)
  })

  // ── Overflow split ───────────────────────────────────────────

  it('after an overflow split, the new analyses point at the fresh chapter summary', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupChain(dataDir, storyId, ['pr-0001'])

    const big = 'Lorem ipsum dolor sit amet. '.repeat(50)
    mockSummary(big + 'A')
    await runLibrarian(dataDir, storyId, 'pr-0001')

    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0002' }))
    await setupChain(dataDir, storyId, ['pr-0001', 'pr-0002'])

    mockSummary(big + 'B')
    const analysisAfter = await runLibrarian(dataDir, storyId, 'pr-0002')

    const active = await listFragments(dataDir, storyId, 'summary')
    const fresh = active.find(f => !f.meta?.isEraSummary && !f.archived)
    const era = active.find(f => f.meta?.isEraSummary)
    expect(fresh).toBeTruthy()
    expect(era).toBeTruthy()

    const refetched = await getAnalysis(dataDir, storyId, analysisAfter.id)
    expect(refetched?.summaryFragmentId).toBe(fresh!.id)
  })

  it('preserves user edits when the next librarian run appends', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupChain(dataDir, storyId, ['pr-0001'])

    mockSummary('Librarian wrote this.')
    await runLibrarian(dataDir, storyId, 'pr-0001')

    // User edits the content.
    const [fragment] = await listFragments(dataDir, storyId, 'summary')
    const edited = 'Writer rewrote this in their own voice.'
    await updateFragment(dataDir, storyId, {
      ...fragment,
      content: edited,
      updatedAt: new Date().toISOString(),
    })

    // Next librarian run on a new prose section.
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0002' }))
    await setupChain(dataDir, storyId, ['pr-0001', 'pr-0002'])

    mockSummary('And then more happened.')
    await runLibrarian(dataDir, storyId, 'pr-0002')

    const [after] = await listFragments(dataDir, storyId, 'summary')
    expect(after.content).toContain(edited)
    expect(after.content).toContain('And then more happened.')
    expect(after.content).not.toContain('Librarian wrote this.')
  })

  // ── Archive semantics ────────────────────────────────────────

  it('excludes archived summaries from the default list', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupChain(dataDir, storyId, ['pr-0001'])

    mockSummary('Summary to be archived.')
    await runLibrarian(dataDir, storyId, 'pr-0001')

    const [fragment] = await listFragments(dataDir, storyId, 'summary')
    await updateFragment(dataDir, storyId, {
      ...fragment,
      archived: true,
      updatedAt: new Date().toISOString(),
    })

    const active = await listFragments(dataDir, storyId, 'summary')
    expect(active).toHaveLength(0)

    const everything = await listFragments(dataDir, storyId, 'summary', { includeArchived: true })
    expect(everything).toHaveLength(1)
    expect(everything[0].archived).toBe(true)
  })

  // ── Migration ────────────────────────────────────────────────

  it('migrates legacy story.summary to an era fragment and clears the field', async () => {
    await createStory(dataDir, makeStory({
      summary: 'Existing rolling summary from before the migration.',
    }))

    const result = await migrateStoryToSummaryFragments(dataDir, storyId)

    expect(result.migrated).toBe(true)
    const fragments = await listFragments(dataDir, storyId, 'summary')
    expect(fragments).toHaveLength(1)
    expect(fragments[0].content).toBe('Existing rolling summary from before the migration.')
    expect(fragments[0].meta?.isEraSummary).toBe(true)

    // Re-run is a no-op (idempotent).
    const second = await migrateStoryToSummaryFragments(dataDir, storyId)
    expect(second.migrated).toBe(false)
    const stillOne = await listFragments(dataDir, storyId, 'summary')
    expect(stillOne).toHaveLength(1)
  })

  it('does not migrate when summary fragments already exist, but still clears legacy field', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupChain(dataDir, storyId, ['pr-0001'])

    mockSummary('Fragment-based summary.')
    await runLibrarian(dataDir, storyId, 'pr-0001')

    // Simulate legacy drift: re-set story.summary after fragments exist.
    const { getStory, updateStory } = await import('@/server/fragments/storage')
    const story = await getStory(dataDir, storyId)
    await updateStory(dataDir, {
      ...story!,
      summary: 'This should not become a second summary fragment.',
      updatedAt: new Date().toISOString(),
    })

    const result = await migrateStoryToSummaryFragments(dataDir, storyId)
    expect(result.migrated).toBe(false)

    const after = await getStory(dataDir, storyId)
    expect(after!.summary).toBe('') // Legacy field cleared.

    const fragments = await listFragments(dataDir, storyId, 'summary')
    expect(fragments).toHaveLength(1)
    expect(fragments[0].content).not.toContain('This should not become a second')
  })

  // ── Sanity: analysis record still carries intent ─────────────

  it('keeps summaryUpdate on the analysis alongside the fragment artifact', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupChain(dataDir, storyId, ['pr-0001'])

    mockSummary('Librarian intent.')
    await runLibrarian(dataDir, storyId, 'pr-0001')

    const analyses = await listAnalyses(dataDir, storyId)
    expect(analyses).toHaveLength(1)
    const full = await getAnalysis(dataDir, storyId, analyses[0].id)
    expect(full?.summaryUpdate).toBe('Librarian intent.')
    expect(full?.summaryFragmentId).toBeDefined()
  })
})
