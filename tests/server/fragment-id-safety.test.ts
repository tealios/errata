import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTempDir, makeTestSettings } from '../setup'
import { createApp } from '@/server/api'
import { createStory, createFragment, getFragment, listFragments } from '@/server/fragments/storage'
import { installFragmentBundle } from '@/server/erratanet/pack-install'
import type { FragmentBundleData } from '@/lib/fragment-clipboard'
import type { Fragment, StoryMeta } from '@/server/fragments/schema'

const STORY_ID = 'story-idsafety'
let dataDir: string
let cleanup: () => Promise<void>

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return { id: STORY_ID, name: 'S', description: '', coverImage: null, summary: '', createdAt: now, updatedAt: now, settings: makeTestSettings() }
}

function makeFragment(id: string): Fragment {
  const now = new Date().toISOString()
  return {
    id, type: 'character', name: 'n', description: 'd', content: 'c', tags: [], refs: [], sticky: false,
    placement: 'user', createdAt: now, updatedAt: now, order: 0, meta: {}, archived: false, version: 1, versions: [],
  }
}

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
  await createStory(dataDir, makeStory())
})
afterEach(async () => {
  await cleanup()
})

describe('fragment id safety', () => {
  it('storage refuses to write a traversal id', async () => {
    await expect(createFragment(dataDir, STORY_ID, makeFragment('../../../escaped'))).rejects.toThrow(/Invalid fragment id/)
    expect(existsSync(join(dataDir, 'escaped.json'))).toBe(false)
  })

  it('getFragment returns null for an invalid id instead of reading outside', async () => {
    expect(await getFragment(dataDir, STORY_ID, '../meta')).toBeNull()
  })

  it('POST create regenerates an invalid client-supplied id', async () => {
    const app = createApp(dataDir)
    const res = await app.fetch(new Request(`http://localhost/api/stories/${STORY_ID}/fragments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'character', name: 'x', description: 'x', content: 'x', id: '../../evil' }),
    }))
    expect(res.status).toBe(200)
    const frag = await res.json() as Fragment
    expect(frag.id).toMatch(/^ch-[a-z]+$/)
    expect(await listFragments(dataDir, STORY_ID)).toHaveLength(1)
  })

  it('install replaces traversal ids and does not let duplicate ids hijack the idMap', async () => {
    const bundle: FragmentBundleData = {
      _errata: 'fragment-bundle',
      version: 1,
      source: 't',
      exportedAt: new Date().toISOString(),
      storyName: 'x',
      fragments: [
        { id: '../../evil', type: 'character', name: 'Evil', description: '', content: 'e', tags: [], refs: [] },
        { id: 'ch-dupdup', type: 'character', name: 'First', description: '', content: 'f', tags: [], refs: [] },
        { id: 'ch-dupdup', type: 'character', name: 'Second', description: '', content: 's', tags: [], refs: ['ch-dupdup'] },
      ],
    } as unknown as FragmentBundleData
    const created = await installFragmentBundle(dataDir, STORY_ID, bundle, { pack: '@a/b', version: '1.0.0' })
    expect(created).toHaveLength(3)
    const ids = created.map((f) => f.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toMatch(/^ch-[a-z]+$/)
    expect(ids[1]).toBe('ch-dupdup')
    expect(ids[2]).not.toBe('ch-dupdup')
    // The second entry's ref to the shared id resolves to the first entry.
    expect(created[2].refs).toEqual(['ch-dupdup'])
  })
})
