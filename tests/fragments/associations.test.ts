import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'
import {
  getAssociations,
  addTag,
  removeTag,
  getFragmentsByTag,
  addRef,
  removeRef,
  getRefs,
  getBackRefs,
} from '@/server/fragments/associations'
import type { StoryMeta } from '@/server/fragments/schema'

let dataDir: string
let cleanup: () => Promise<void>
const storyId = 'story-1'

const makeStory = (): StoryMeta => ({
  id: storyId,
  name: 'Test Story',
  description: 'A test',
    coverImage: null,
  summary: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: makeTestSettings(),
})

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
  await createStory(dataDir, makeStory())
})

afterEach(async () => {
  await cleanup()
})

describe('Tag operations', () => {
  it('starts with empty associations', async () => {
    const assoc = await getAssociations(dataDir, storyId)
    expect(assoc.tagIndex).toEqual({})
    expect(assoc.refIndex).toEqual({})
  })

  it('adds a tag to a fragment', async () => {
    await addTag(dataDir, storyId, 'pr-a1b2', 'chapter-1')
    const fragments = await getFragmentsByTag(dataDir, storyId, 'chapter-1')
    expect(fragments).toEqual(['pr-a1b2'])
  })

  it('adds multiple fragments to a tag', async () => {
    await addTag(dataDir, storyId, 'pr-a1b2', 'chapter-1')
    await addTag(dataDir, storyId, 'pr-c3d4', 'chapter-1')
    const fragments = await getFragmentsByTag(dataDir, storyId, 'chapter-1')
    expect(fragments).toHaveLength(2)
    expect(fragments).toContain('pr-a1b2')
    expect(fragments).toContain('pr-c3d4')
  })

  it('does not duplicate tags', async () => {
    await addTag(dataDir, storyId, 'pr-a1b2', 'chapter-1')
    await addTag(dataDir, storyId, 'pr-a1b2', 'chapter-1')
    const fragments = await getFragmentsByTag(dataDir, storyId, 'chapter-1')
    expect(fragments).toHaveLength(1)
  })

  it('removes a tag from a fragment', async () => {
    await addTag(dataDir, storyId, 'pr-a1b2', 'chapter-1')
    await addTag(dataDir, storyId, 'pr-c3d4', 'chapter-1')
    await removeTag(dataDir, storyId, 'pr-a1b2', 'chapter-1')
    const fragments = await getFragmentsByTag(dataDir, storyId, 'chapter-1')
    expect(fragments).toEqual(['pr-c3d4'])
  })

  it('returns empty array for unknown tag', async () => {
    const fragments = await getFragmentsByTag(dataDir, storyId, 'nonexistent')
    expect(fragments).toEqual([])
  })
})

describe('Ref operations', () => {
  it('adds a reference between fragments', async () => {
    await addRef(dataDir, storyId, 'pr-a1b2', 'ch-x9y8')
    const refs = await getRefs(dataDir, storyId, 'pr-a1b2')
    expect(refs).toEqual(['ch-x9y8'])
  })

  it('tracks bidirectional back-references', async () => {
    await addRef(dataDir, storyId, 'pr-a1b2', 'ch-x9y8')
    const backRefs = await getBackRefs(dataDir, storyId, 'ch-x9y8')
    expect(backRefs).toContain('pr-a1b2')
  })

  it('does not duplicate refs', async () => {
    await addRef(dataDir, storyId, 'pr-a1b2', 'ch-x9y8')
    await addRef(dataDir, storyId, 'pr-a1b2', 'ch-x9y8')
    const refs = await getRefs(dataDir, storyId, 'pr-a1b2')
    expect(refs).toHaveLength(1)
  })

  it('removes a reference', async () => {
    await addRef(dataDir, storyId, 'pr-a1b2', 'ch-x9y8')
    await removeRef(dataDir, storyId, 'pr-a1b2', 'ch-x9y8')
    const refs = await getRefs(dataDir, storyId, 'pr-a1b2')
    expect(refs).toEqual([])
  })

  it('cleans up back-references on removal', async () => {
    await addRef(dataDir, storyId, 'pr-a1b2', 'ch-x9y8')
    await removeRef(dataDir, storyId, 'pr-a1b2', 'ch-x9y8')
    const backRefs = await getBackRefs(dataDir, storyId, 'ch-x9y8')
    expect(backRefs).toEqual([])
  })

  it('returns empty array for unknown fragment refs', async () => {
    const refs = await getRefs(dataDir, storyId, 'pr-zzzz')
    expect(refs).toEqual([])
  })
})
