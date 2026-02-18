import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'
import {
  saveAnalysis,
  getAnalysis,
  listAnalyses,
  getState,
  saveState,
  getLatestAnalysisIdsByFragment,
  rebuildAnalysisIndex,
  type LibrarianAnalysis,
  type LibrarianState,
} from '@/server/librarian/storage'

function makeAnalysis(overrides: Partial<LibrarianAnalysis> = {}): LibrarianAnalysis {
  return {
    id: `analysis-${Date.now()}`,
    createdAt: new Date().toISOString(),
    fragmentId: 'pr-0001',
    summaryUpdate: 'The hero entered the cave.',
    mentionedCharacters: ['ch-0001'],
    contradictions: [],
    knowledgeSuggestions: [],
    timelineEvents: [],
    ...overrides,
  }
}

describe('librarian storage', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-lib-test'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await createStory(dataDir, {
      id: storyId,
      name: 'Test Story',
      description: 'For librarian tests',
      summary: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: makeTestSettings(),
    })
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('analysis CRUD', () => {
    it('saves and loads an analysis round-trip', async () => {
      const analysis = makeAnalysis({ id: 'analysis-a' })
      await saveAnalysis(dataDir, storyId, analysis)

      const loaded = await getAnalysis(dataDir, storyId, 'analysis-a')
      expect(loaded).toEqual(analysis)
    })

    it('returns null for non-existent analysis', async () => {
      const loaded = await getAnalysis(dataDir, storyId, 'nonexistent')
      expect(loaded).toBeNull()
    })

    it('lists analyses sorted newest first', async () => {
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-old',
        createdAt: '2025-01-01T00:00:00.000Z',
      }))
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-new',
        createdAt: '2025-01-02T00:00:00.000Z',
      }))

      const summaries = await listAnalyses(dataDir, storyId)
      expect(summaries).toHaveLength(2)
      expect(summaries[0].id).toBe('analysis-new')
      expect(summaries[1].id).toBe('analysis-old')
    })

    it('list returns summaries with counts', async () => {
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-counts',
        contradictions: [
          { description: 'Eye color changed', fragmentIds: ['pr-0001', 'pr-0002'] },
        ],
        knowledgeSuggestions: [
          { type: 'knowledge' as const, name: 'Cave', description: 'The dark cave', content: 'A cave in the mountains' },
        ],
        timelineEvents: [
          { event: 'Entered cave', position: 'during' },
          { event: 'Found sword', position: 'after' },
        ],
      }))

      const summaries = await listAnalyses(dataDir, storyId)
      expect(summaries[0].contradictionCount).toBe(1)
      expect(summaries[0].suggestionCount).toBe(1)
      expect(summaries[0].pendingSuggestionCount).toBe(1)
      expect(summaries[0].timelineEventCount).toBe(2)
    })

    it('returns empty list when no analyses exist', async () => {
      const summaries = await listAnalyses(dataDir, storyId)
      expect(summaries).toEqual([])
    })

    it('updates latest-analysis index on save and reanalysis', async () => {
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-old',
        fragmentId: 'pr-0001',
        createdAt: '2025-01-01T00:00:00.000Z',
      }))
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-new',
        fragmentId: 'pr-0001',
        createdAt: '2025-01-02T00:00:00.000Z',
      }))
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-other',
        fragmentId: 'pr-0002',
        createdAt: '2025-01-03T00:00:00.000Z',
      }))

      const latest = await getLatestAnalysisIdsByFragment(dataDir, storyId)
      expect(latest.get('pr-0001')).toBe('analysis-new')
      expect(latest.get('pr-0002')).toBe('analysis-other')
    })

    it('rebuilds analysis index from analysis files', async () => {
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-a',
        fragmentId: 'pr-0001',
        createdAt: '2025-01-01T00:00:00.000Z',
      }))
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-b',
        fragmentId: 'pr-0001',
        createdAt: '2025-01-05T00:00:00.000Z',
      }))

      const rebuilt = await rebuildAnalysisIndex(dataDir, storyId)
      expect(rebuilt.latestByFragmentId['pr-0001']?.analysisId).toBe('analysis-b')

      const latest = await getLatestAnalysisIdsByFragment(dataDir, storyId)
      expect(latest.get('pr-0001')).toBe('analysis-b')
    })
  })

  describe('state persistence', () => {
    it('returns default state for new stories', async () => {
      const state = await getState(dataDir, storyId)
      expect(state).toEqual({
        lastAnalyzedFragmentId: null,
        summarizedUpTo: null,
        recentMentions: {},
        timeline: [],
      })
    })

    it('saves and loads state', async () => {
      const state: LibrarianState = {
        lastAnalyzedFragmentId: 'pr-0001',
        summarizedUpTo: null,
        recentMentions: {
          'ch-0001': ['pr-0001', 'pr-0002'],
        },
        timeline: [
          { event: 'Hero entered cave', fragmentId: 'pr-0001' },
        ],
      }
      await saveState(dataDir, storyId, state)

      const loaded = await getState(dataDir, storyId)
      expect(loaded).toEqual(state)
    })

    it('overwrites previous state on save', async () => {
      await saveState(dataDir, storyId, {
        lastAnalyzedFragmentId: 'pr-0001',
        summarizedUpTo: null,
        recentMentions: {},
        timeline: [],
      })

      await saveState(dataDir, storyId, {
        lastAnalyzedFragmentId: 'pr-0002',
        summarizedUpTo: null,
        recentMentions: { 'ch-0001': ['pr-0002'] },
        timeline: [{ event: 'Battle', fragmentId: 'pr-0002' }],
      })

      const loaded = await getState(dataDir, storyId)
      expect(loaded.lastAnalyzedFragmentId).toBe('pr-0002')
      expect(loaded.recentMentions['ch-0001']).toEqual(['pr-0002'])
      expect(loaded.timeline).toHaveLength(1)
    })
  })
})
