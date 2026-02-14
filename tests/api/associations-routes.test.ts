import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir } from '../setup'
import { createApp } from '@/server/api'
import { createStory, createFragment, getFragment } from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'Test',
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: { outputFormat: 'markdown', enabledPlugins: [] },
  }
}

function makeFragment(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'pr-0001',
    type: 'prose',
    name: 'Test',
    description: 'Test fragment',
    content: 'Content',
    tags: [],
    refs: [],
    sticky: false,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    ...overrides,
  }
}

describe('association & sticky API routes', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>
  const storyId = 'story-test'

  async function api(path: string, init?: RequestInit) {
    const res = await app.fetch(new Request(`http://localhost/api${path}`, init))
    return { status: res.status, json: async () => res.json() }
  }

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    app = createApp(dataDir)
    await createStory(dataDir, makeStory())
  })

  afterEach(async () => {
    await cleanup()
  })

  // --- Tag routes ---

  describe('tags', () => {
    it('POST adds a tag to a fragment', async () => {
      await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))

      const res = await api(`/stories/${storyId}/fragments/pr-0001/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'important' }),
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.ok).toBe(true)
    })

    it('GET returns tags for a fragment', async () => {
      await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))

      await api(`/stories/${storyId}/fragments/pr-0001/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'action' }),
      })
      await api(`/stories/${storyId}/fragments/pr-0001/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'drama' }),
      })

      const res = await api(`/stories/${storyId}/fragments/pr-0001/tags`)
      expect(res.status).toBe(200)

      const data = await res.json() as { tags: string[] }
      expect(data.tags).toContain('action')
      expect(data.tags).toContain('drama')
    })

    it('DELETE removes a tag from a fragment', async () => {
      await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))

      await api(`/stories/${storyId}/fragments/pr-0001/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'toremove' }),
      })

      const delRes = await api(`/stories/${storyId}/fragments/pr-0001/tags`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'toremove' }),
      })
      expect(delRes.status).toBe(200)

      const getRes = await api(`/stories/${storyId}/fragments/pr-0001/tags`)
      const data = await getRes.json() as { tags: string[] }
      expect(data.tags).not.toContain('toremove')
    })
  })

  // --- Ref routes ---

  describe('refs', () => {
    it('POST adds a ref between fragments', async () => {
      await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
      await createFragment(dataDir, storyId, makeFragment({ id: 'ch-0001', type: 'character', name: 'Hero' }))

      const res = await api(`/stories/${storyId}/fragments/pr-0001/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: 'ch-0001' }),
      })
      expect(res.status).toBe(200)
    })

    it('GET returns refs for a fragment', async () => {
      await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
      await createFragment(dataDir, storyId, makeFragment({ id: 'ch-0001', type: 'character', name: 'Hero' }))

      await api(`/stories/${storyId}/fragments/pr-0001/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: 'ch-0001' }),
      })

      const res = await api(`/stories/${storyId}/fragments/pr-0001/refs`)
      expect(res.status).toBe(200)

      const data = await res.json() as { refs: string[]; backRefs: string[] }
      expect(data.refs).toContain('ch-0001')
    })

    it('GET returns back-refs', async () => {
      await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
      await createFragment(dataDir, storyId, makeFragment({ id: 'ch-0001', type: 'character', name: 'Hero' }))

      await api(`/stories/${storyId}/fragments/pr-0001/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: 'ch-0001' }),
      })

      const res = await api(`/stories/${storyId}/fragments/ch-0001/refs`)
      const data = await res.json() as { refs: string[]; backRefs: string[] }
      expect(data.backRefs).toContain('pr-0001')
    })

    it('DELETE removes a ref', async () => {
      await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
      await createFragment(dataDir, storyId, makeFragment({ id: 'ch-0001', type: 'character', name: 'Hero' }))

      await api(`/stories/${storyId}/fragments/pr-0001/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: 'ch-0001' }),
      })

      const delRes = await api(`/stories/${storyId}/fragments/pr-0001/refs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: 'ch-0001' }),
      })
      expect(delRes.status).toBe(200)

      const getRes = await api(`/stories/${storyId}/fragments/pr-0001/refs`)
      const data = await getRes.json() as { refs: string[]; backRefs: string[] }
      expect(data.refs).not.toContain('ch-0001')
    })
  })

  // --- Sticky toggle ---

  describe('sticky', () => {
    it('PATCH toggles sticky on a fragment', async () => {
      await createFragment(dataDir, storyId, makeFragment({ id: 'gl-0001', type: 'guideline', sticky: false }))

      const res = await api(`/stories/${storyId}/fragments/gl-0001/sticky`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sticky: true }),
      })
      expect(res.status).toBe(200)

      const frag = await getFragment(dataDir, storyId, 'gl-0001')
      expect(frag!.sticky).toBe(true)
    })

    it('PATCH can unset sticky', async () => {
      await createFragment(dataDir, storyId, makeFragment({ id: 'gl-0001', type: 'guideline', sticky: true }))

      const res = await api(`/stories/${storyId}/fragments/gl-0001/sticky`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sticky: false }),
      })
      expect(res.status).toBe(200)

      const frag = await getFragment(dataDir, storyId, 'gl-0001')
      expect(frag!.sticky).toBe(false)
    })
  })
})
