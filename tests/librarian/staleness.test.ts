import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory, createFragment, updateFragmentVersioned, deleteFragment } from '@/server/fragments/storage'
import { saveAnalysis, listAnalyses, deleteAnalyses, getLatestAnalysisIdsByFragment, type LibrarianAnalysis } from '@/server/librarian/storage'
import { listAnalysesWithStaleness } from '@/server/librarian/staleness'

const storyId = 'story-stale'

function makeAnalysis(overrides: Partial<LibrarianAnalysis> = {}): LibrarianAnalysis {
  return {
    id: 'la-x',
    createdAt: '2025-01-01T00:00:00.000Z',
    fragmentId: 'pr-aaaa',
    summaryUpdate: '',
    mentionedCharacters: [],
    contradictions: [{ description: 'c', fragmentIds: [] }],
    fragmentSuggestions: [],
    timelineEvents: [],
    ...overrides,
  }
}

async function makeProse(dataDir: string, id: string) {
  await createFragment(dataDir, storyId, {
    id,
    type: 'prose',
    name: id,
    description: '',
    content: 'Original.',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    order: 0,
    meta: {},
  })
}

describe('librarian analysis staleness', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await createStory(dataDir, {
      id: storyId,
      name: 'S',
      description: '',
      coverImage: null,
      summary: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      settings: makeTestSettings(),
    })
  })

  afterEach(async () => { await cleanup() })

  it('marks the latest analysis of an untouched fragment as fresh', async () => {
    await makeProse(dataDir, 'pr-aaaa')
    await saveAnalysis(dataDir, storyId, makeAnalysis({ id: 'la-1', createdAt: new Date().toISOString(), fragmentVersion: 1 }))
    const list = await listAnalysesWithStaleness(dataDir, storyId)
    expect(list).toHaveLength(1)
    expect(list[0].stale).toBe(false)
  })

  it('marks analyses superseded by a newer analysis of the same fragment as stale', async () => {
    await makeProse(dataDir, 'pr-aaaa')
    const now = Date.now()
    await saveAnalysis(dataDir, storyId, makeAnalysis({ id: 'la-old', createdAt: new Date(now - 1000).toISOString() }))
    await saveAnalysis(dataDir, storyId, makeAnalysis({ id: 'la-new', createdAt: new Date(now).toISOString() }))
    const list = await listAnalysesWithStaleness(dataDir, storyId)
    const byId = Object.fromEntries(list.map((a) => [a.id, a]))
    expect(byId['la-old'].stale).toBe(true)
    expect(byId['la-old'].staleReason).toBe('superseded')
    expect(byId['la-new'].stale).toBe(false)
  })

  it('marks an analysis stale when its prose was edited afterwards (recorded version)', async () => {
    await makeProse(dataDir, 'pr-aaaa')
    await saveAnalysis(dataDir, storyId, makeAnalysis({ id: 'la-1', createdAt: new Date().toISOString(), fragmentVersion: 1 }))
    await updateFragmentVersioned(dataDir, storyId, 'pr-aaaa', { content: 'Fixed.' })
    const [a] = await listAnalysesWithStaleness(dataDir, storyId)
    expect(a.stale).toBe(true)
    expect(a.staleReason).toBe('edited')
  })

  it('marks a legacy analysis (no recorded version) stale when a version snapshot postdates it', async () => {
    await makeProse(dataDir, 'pr-aaaa')
    await saveAnalysis(dataDir, storyId, makeAnalysis({ id: 'la-1', createdAt: '2025-01-02T00:00:00.000Z' }))
    await updateFragmentVersioned(dataDir, storyId, 'pr-aaaa', { content: 'Fixed.' })
    const [a] = await listAnalysesWithStaleness(dataDir, storyId)
    expect(a.stale).toBe(true)
    expect(a.staleReason).toBe('edited')
  })

  it('does not treat non-content updates as edits', async () => {
    await makeProse(dataDir, 'pr-aaaa')
    await saveAnalysis(dataDir, storyId, makeAnalysis({ id: 'la-1', createdAt: new Date().toISOString(), fragmentVersion: 1 }))
    await updateFragmentVersioned(dataDir, storyId, 'pr-aaaa', {}, { extra: { sticky: true } })
    const [a] = await listAnalysesWithStaleness(dataDir, storyId)
    expect(a.stale).toBe(false)
  })

  it('marks analyses of deleted prose as stale', async () => {
    await makeProse(dataDir, 'pr-aaaa')
    await saveAnalysis(dataDir, storyId, makeAnalysis({ id: 'la-1', createdAt: new Date().toISOString() }))
    await deleteFragment(dataDir, storyId, 'pr-aaaa')
    const [a] = await listAnalysesWithStaleness(dataDir, storyId)
    expect(a.stale).toBe(true)
    expect(a.staleReason).toBe('missing')
  })

  it('deleteAnalyses removes several analyses and rebuilds the index', async () => {
    await saveAnalysis(dataDir, storyId, makeAnalysis({ id: 'la-a', fragmentId: 'pr-aaaa', createdAt: '2025-01-01T00:00:00.000Z' }))
    await saveAnalysis(dataDir, storyId, makeAnalysis({ id: 'la-b', fragmentId: 'pr-aaaa', createdAt: '2025-01-02T00:00:00.000Z' }))
    await saveAnalysis(dataDir, storyId, makeAnalysis({ id: 'la-c', fragmentId: 'pr-bbbb', createdAt: '2025-01-03T00:00:00.000Z' }))

    const removed = await deleteAnalyses(dataDir, storyId, ['la-b', 'la-c', 'la-missing'])
    expect(removed).toEqual(['la-b', 'la-c'])
    expect((await listAnalyses(dataDir, storyId)).map((a) => a.id)).toEqual(['la-a'])
    expect(Object.fromEntries(await getLatestAnalysisIdsByFragment(dataDir, storyId))).toEqual({ 'pr-aaaa': 'la-a' })
  })
})
