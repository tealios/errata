import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir } from '../setup'
import {
  createStory,
  getStory,
  listStories,
  updateStory,
  deleteStory,
  createFragment,
  getFragment,
  listFragments,
  updateFragment,
  deleteFragment,
} from '@/server/fragments/storage'
import type { Fragment, StoryMeta } from '@/server/fragments/schema'

let dataDir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
})

afterEach(async () => {
  await cleanup()
})

const makeStory = (overrides: Partial<StoryMeta> = {}): StoryMeta => ({
  id: 'story-1',
  name: 'Test Story',
  description: 'A test story',
  summary: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: { outputFormat: 'markdown', enabledPlugins: [] },
  ...overrides,
})

const makeFragment = (overrides: Partial<Fragment> = {}): Fragment => ({
  id: 'pr-a1b2',
  type: 'prose',
  name: 'Opening',
  description: 'The story begins',
  content: 'It was a dark and stormy night...',
  tags: [],
  refs: [],
  sticky: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  order: 0,
  meta: {},
  ...overrides,
})

describe('Story CRUD', () => {
  it('creates and retrieves a story', async () => {
    const story = makeStory()
    await createStory(dataDir, story)
    const retrieved = await getStory(dataDir, story.id)
    expect(retrieved).toEqual(story)
  })

  it('lists all stories', async () => {
    await createStory(dataDir, makeStory({ id: 'story-1' }))
    await createStory(dataDir, makeStory({ id: 'story-2', name: 'Second' }))
    const stories = await listStories(dataDir)
    expect(stories).toHaveLength(2)
    expect(stories.map((s) => s.id).sort()).toEqual(['story-1', 'story-2'])
  })

  it('updates a story', async () => {
    const story = makeStory()
    await createStory(dataDir, story)
    const updated = { ...story, name: 'Updated Name' }
    await updateStory(dataDir, updated)
    const retrieved = await getStory(dataDir, story.id)
    expect(retrieved.name).toBe('Updated Name')
  })

  it('deletes a story', async () => {
    const story = makeStory()
    await createStory(dataDir, story)
    await deleteStory(dataDir, story.id)
    const stories = await listStories(dataDir)
    expect(stories).toHaveLength(0)
  })

  it('returns null for non-existent story', async () => {
    const result = await getStory(dataDir, 'nonexistent')
    expect(result).toBeNull()
  })
})

describe('Fragment CRUD', () => {
  const storyId = 'story-1'

  beforeEach(async () => {
    await createStory(dataDir, makeStory({ id: storyId }))
  })

  it('creates and retrieves a fragment', async () => {
    const fragment = makeFragment()
    await createFragment(dataDir, storyId, fragment)
    const retrieved = await getFragment(dataDir, storyId, fragment.id)
    expect(retrieved).toEqual(fragment)
  })

  it('lists fragments by type', async () => {
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-a1b2' }))
    await createFragment(
      dataDir,
      storyId,
      makeFragment({ id: 'pr-c3d4', name: 'Second' })
    )
    await createFragment(
      dataDir,
      storyId,
      makeFragment({ id: 'ch-x9y8', type: 'character', name: 'Alice' })
    )

    const prose = await listFragments(dataDir, storyId, 'prose')
    expect(prose).toHaveLength(2)

    const characters = await listFragments(dataDir, storyId, 'character')
    expect(characters).toHaveLength(1)
  })

  it('lists all fragments when no type filter', async () => {
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-a1b2' }))
    await createFragment(
      dataDir,
      storyId,
      makeFragment({ id: 'ch-x9y8', type: 'character', name: 'Alice' })
    )
    const all = await listFragments(dataDir, storyId)
    expect(all).toHaveLength(2)
  })

  it('updates a fragment', async () => {
    const fragment = makeFragment()
    await createFragment(dataDir, storyId, fragment)
    const updated = { ...fragment, content: 'New content here.' }
    await updateFragment(dataDir, storyId, updated)
    const retrieved = await getFragment(dataDir, storyId, fragment.id)
    expect(retrieved!.content).toBe('New content here.')
  })

  it('deletes a fragment', async () => {
    const fragment = makeFragment()
    await createFragment(dataDir, storyId, fragment)
    await deleteFragment(dataDir, storyId, fragment.id)
    const result = await getFragment(dataDir, storyId, fragment.id)
    expect(result).toBeNull()
  })

  it('returns null for non-existent fragment', async () => {
    const result = await getFragment(dataDir, storyId, 'pr-zzzz')
    expect(result).toBeNull()
  })
})
