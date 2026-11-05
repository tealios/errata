import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createApp } from '@/server/api'
import { createStory, createFragment, getFragment } from '@/server/fragments/storage'
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

describe('PATCH fragment text replace', () => {
  it('treats newText literally (no $ pattern expansion)', async () => {
    await createFragment(dataDir, STORY_ID, makeFragment('ch-aaaaaa', 'price: X end'))
    const res = await call('/fragments/ch-aaaaaa', 'PATCH', { oldText: 'X', newText: '$& costs $1 and $$' })
    expect(res.status).toBe(200)
    expect((await getFragment(dataDir, STORY_ID, 'ch-aaaaaa'))!.content).toBe('price: $& costs $1 and $$ end')
  })

  it('returns 422 when oldText is not found and leaves the fragment untouched', async () => {
    await createFragment(dataDir, STORY_ID, makeFragment('ch-aaaaaa', 'hello'))
    const res = await call('/fragments/ch-aaaaaa', 'PATCH', { oldText: 'nope', newText: 'x' })
    expect(res.status).toBe(422)
    const frag = (await getFragment(dataDir, STORY_ID, 'ch-aaaaaa'))!
    expect(frag.content).toBe('hello')
    expect(frag.version).toBe(1)
  })
})
