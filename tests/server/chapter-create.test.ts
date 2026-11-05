import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createApp } from '@/server/api'
import { createStory, listFragments } from '@/server/fragments/storage'
import { getProseChain } from '@/server/fragments/prose-chain'
import type { Fragment, StoryMeta } from '@/server/fragments/schema'

const STORY_ID = 'story-routes'
let dataDir: string
let cleanup: () => Promise<void>
let app: ReturnType<typeof createApp>

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

async function call(path: string, method: string, body?: unknown) {
  return app.fetch(new Request(`http://localhost/api/stories/${STORY_ID}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
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

describe('chapter create', () => {
  it('returns the created fragment', async () => {
    const res = await call('/chapters', 'POST', { name: 'Ch 1', position: 0 })
    expect(res.status).toBe(200)
    const data = await res.json() as { fragment: Fragment }
    expect(data.fragment.id).toMatch(/^mk-/)
    expect(data.fragment.name).toBe('Ch 1')
    expect(data.fragment.type).toBe('marker')
    const stored = await listFragments(dataDir, STORY_ID, 'marker')
    expect(stored.map((f) => f.id)).toEqual([data.fragment.id])
    expect((await getProseChain(dataDir, STORY_ID)).entries).toHaveLength(1)
  })
})
