import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createApp } from '@/server/api'
import {
  createStory,
  createFragment,
  getFragment,
  updateFragmentVersioned,
  archiveFragment,
  mutateFragment,
} from '@/server/fragments/storage'
import type { Fragment, StoryMeta } from '@/server/fragments/schema'

const STORY_ID = 'story-locking'
let dataDir: string
let cleanup: () => Promise<void>

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return { id: STORY_ID, name: 'S', description: '', coverImage: null, summary: '', createdAt: now, updatedAt: now, settings: makeTestSettings() }
}

function makeFragment(id: string, content = 'c'): Fragment {
  const now = new Date().toISOString()
  return {
    id, type: 'character', name: 'n', description: 'd', content, tags: [], refs: [], sticky: false,
    placement: 'user', createdAt: now, updatedAt: now, order: 0, meta: {}, archived: false, version: 1, versions: [],
  }
}

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
  await createStory(dataDir, makeStory())
  await createFragment(dataDir, STORY_ID, makeFragment('ch-aaaaaa', 'start'))
})
afterEach(async () => {
  await cleanup()
})

describe('fragment update locking', () => {
  it('concurrent versioned updates do not lose versions', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        updateFragmentVersioned(dataDir, STORY_ID, 'ch-aaaaaa', { content: `v${i}` }),
      ),
    )
    const frag = (await getFragment(dataDir, STORY_ID, 'ch-aaaaaa'))!
    expect(frag.version).toBe(9)
    expect(frag.versions).toHaveLength(8)
  })

  it('archive racing a content edit keeps both changes', async () => {
    await Promise.all([
      updateFragmentVersioned(dataDir, STORY_ID, 'ch-aaaaaa', { content: 'edited' }),
      archiveFragment(dataDir, STORY_ID, 'ch-aaaaaa'),
      mutateFragment(dataDir, STORY_ID, 'ch-aaaaaa', (f) => ({ ...f, sticky: true })),
    ])
    const frag = (await getFragment(dataDir, STORY_ID, 'ch-aaaaaa'))!
    expect(frag.content).toBe('edited')
    expect(frag.archived).toBe(true)
    expect(frag.sticky).toBe(true)
  })

  it('PUT writes versioned fields and extras together', async () => {
    const app = createApp(dataDir)
    const res = await app.fetch(new Request(`http://localhost/api/stories/${STORY_ID}/fragments/ch-aaaaaa`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'n2', description: 'd', content: 'new', sticky: true, order: 7 }),
    }))
    expect(res.status).toBe(200)
    const frag = (await getFragment(dataDir, STORY_ID, 'ch-aaaaaa'))!
    expect(frag).toMatchObject({ name: 'n2', content: 'new', sticky: true, order: 7, version: 2 })
  })

  it('concurrent PATCH text replaces compose instead of clobbering', async () => {
    await mutateFragment(dataDir, STORY_ID, 'ch-aaaaaa', (f) => ({ ...f, content: 'A B' }))
    const app = createApp(dataDir)
    const patch = (oldText: string, newText: string) =>
      app.fetch(new Request(`http://localhost/api/stories/${STORY_ID}/fragments/ch-aaaaaa`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldText, newText }),
      }))
    await Promise.all([patch('A', 'X'), patch('B', 'Y')])
    expect((await getFragment(dataDir, STORY_ID, 'ch-aaaaaa'))!.content).toBe('X Y')
  })
})
