import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory, createFragment, getFragment, archiveFragment } from '@/server/fragments/storage'
import { addTag, addRef, getAssociations } from '@/server/fragments/associations'
import { createFolder, assignFragment, getAssignments } from '@/server/fragments/folders'
import { getProseChain, saveProseChain } from '@/server/fragments/prose-chain'
import { deleteFragmentCascade } from '@/server/fragments/delete'
import type { Fragment } from '@/server/fragments/schema'

const storyId = 'story-1'
let dataDir: string
let cleanup: () => Promise<void>

function frag(id: string, type: string, extra: Partial<Fragment> = {}): Fragment {
  return {
    id, type, name: id, description: 'd', content: 'c', tags: [], refs: [], sticky: false,
    placement: 'user', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    order: 0, meta: {}, archived: false, version: 1, versions: [], ...extra,
  } as Fragment
}

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
  await createStory(dataDir, {
    id: storyId, name: 'S', description: 'd', coverImage: null, summary: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    settings: makeTestSettings(),
  })
  await createFragment(dataDir, storyId, frag('ch-alice', 'character'))
  await createFragment(dataDir, storyId, frag('ch-bobby', 'character', {
    refs: ['ch-alice', 'ch-carol'],
    meta: { visualRefs: [{ fragmentId: 'im-pic1', kind: 'image' }, { fragmentId: 'im-pic2', kind: 'image' }] },
  }))
  await createFragment(dataDir, storyId, frag('ch-carol', 'character'))
})

afterEach(async () => {
  await cleanup()
})

describe('deleteFragmentCascade', () => {
  it('removes the fragment file', async () => {
    await deleteFragmentCascade(dataDir, storyId, 'ch-alice')
    expect(await getFragment(dataDir, storyId, 'ch-alice')).toBeNull()
  })

  it('cleans tag and ref indexes including backrefs', async () => {
    await addTag(dataDir, storyId, 'ch-alice', 'hero')
    await addTag(dataDir, storyId, 'ch-carol', 'hero')
    await addTag(dataDir, storyId, 'ch-alice', 'solo')
    await addRef(dataDir, storyId, 'ch-bobby', 'ch-alice')
    await addRef(dataDir, storyId, 'ch-alice', 'ch-carol')
    await deleteFragmentCascade(dataDir, storyId, 'ch-alice')
    const assoc = await getAssociations(dataDir, storyId)
    expect(assoc.tagIndex).toEqual({ hero: ['ch-carol'] })
    expect(assoc.refIndex).toEqual({})
  })

  it('removes the id from other fragments refs', async () => {
    await deleteFragmentCascade(dataDir, storyId, 'ch-alice')
    expect((await getFragment(dataDir, storyId, 'ch-bobby'))!.refs).toEqual(['ch-carol'])
  })

  it('removes matching visualRefs from other fragments', async () => {
    await deleteFragmentCascade(dataDir, storyId, 'im-pic1')
    expect((await getFragment(dataDir, storyId, 'ch-bobby'))!.meta.visualRefs)
      .toEqual([{ fragmentId: 'im-pic2', kind: 'image' }])
  })

  it('clears folder assignment', async () => {
    const folder = await createFolder(dataDir, storyId, 'F')
    await assignFragment(dataDir, storyId, 'ch-alice', folder.id)
    await assignFragment(dataDir, storyId, 'ch-carol', folder.id)
    await deleteFragmentCascade(dataDir, storyId, 'ch-alice')
    expect(await getAssignments(dataDir, storyId)).toEqual({ 'ch-carol': folder.id })
  })

  it('fixes prose chain: variation removed, active repointed, empty entry dropped', async () => {
    await saveProseChain(dataDir, storyId, {
      entries: [
        { proseFragments: ['pr-aaaa', 'pr-bbbb'], active: 'pr-bbbb' },
        { proseFragments: ['pr-cccc'], active: 'pr-cccc' },
        { proseFragments: ['pr-dddd', 'pr-eeee'], active: 'pr-dddd' },
      ],
    })
    await deleteFragmentCascade(dataDir, storyId, 'pr-bbbb')
    await deleteFragmentCascade(dataDir, storyId, 'pr-cccc')
    await deleteFragmentCascade(dataDir, storyId, 'pr-eeee')
    expect((await getProseChain(dataDir, storyId))!.entries).toEqual([
      { proseFragments: ['pr-aaaa'], active: 'pr-aaaa' },
      { proseFragments: ['pr-dddd'], active: 'pr-dddd' },
    ])
  })

  it('archive does not cascade', async () => {
    await addTag(dataDir, storyId, 'ch-alice', 'hero')
    await archiveFragment(dataDir, storyId, 'ch-alice')
    expect((await getAssociations(dataDir, storyId)).tagIndex.hero).toEqual(['ch-alice'])
    expect((await getFragment(dataDir, storyId, 'ch-bobby'))!.refs).toContain('ch-alice')
  })
})
