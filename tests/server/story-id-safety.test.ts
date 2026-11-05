import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTempDir, makeTestSettings } from '../setup'
import { createApp } from '@/server/api'
import { createStory, getStory, deleteStory, listFragments } from '@/server/fragments/storage'
import { getContentRootForBranch } from '@/server/fragments/branches'
import { listFolders } from '@/server/fragments/folders'
import type { StoryMeta } from '@/server/fragments/schema'

let dataDir: string
let cleanup: () => Promise<void>

function makeStory(id: string): StoryMeta {
  const now = new Date().toISOString()
  return { id, name: 'S', description: '', coverImage: null, summary: '', createdAt: now, updatedAt: now, settings: makeTestSettings() }
}

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
})
afterEach(async () => {
  await cleanup()
})

describe('story / branch id safety', () => {
  it('createStory refuses traversal ids', async () => {
    await expect(createStory(dataDir, makeStory('../escape'))).rejects.toThrow(/Invalid story id/)
  })

  it('getStory returns null and deleteStory is a no-op for traversal ids', async () => {
    await mkdir(join(dataDir, 'keepme'), { recursive: true })
    await writeFile(join(dataDir, 'keepme', 'meta.json'), '{}')
    expect(await getStory(dataDir, '../keepme')).toBeNull()
    await deleteStory(dataDir, '../keepme')
    expect(existsSync(join(dataDir, 'keepme'))).toBe(true)
  })

  it('path helpers throw for invalid story / branch ids', async () => {
    await expect(listFragments(dataDir, '../x')).rejects.toThrow(/Invalid story id/)
    await expect(listFolders(dataDir, '../x')).rejects.toThrow(/Invalid story id/)
    await createStory(dataDir, makeStory('ok-story'))
    await expect(getContentRootForBranch(dataDir, 'ok-story', '../../x')).rejects.toThrow(/Invalid branch id/)
  })

  it('DELETE and export routes 404 on invalid ids', async () => {
    const app = createApp(dataDir)
    const del = await app.fetch(new Request('http://localhost/api/stories/..%2F..%2Fx', { method: 'DELETE' }))
    expect(del.status).toBe(404)
    const exp = await app.fetch(new Request('http://localhost/api/stories/..%2F..%2Fx/export'))
    expect(exp.status).toBe(404)
    const missing = await app.fetch(new Request('http://localhost/api/stories/nope-story/export'))
    expect(missing.status).toBe(404)
  })
})
