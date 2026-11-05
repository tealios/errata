import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'
import { createBranch, getBranchesIndex, renameBranch } from '@/server/fragments/branches'
import type { StoryMeta } from '@/server/fragments/schema'

const STORY_ID = 'story-branches'
let dataDir: string
let cleanup: () => Promise<void>

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return { id: STORY_ID, name: 'S', description: '', coverImage: null, summary: '', createdAt: now, updatedAt: now, settings: makeTestSettings() }
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

describe('createBranch hardening', () => {
  it('rejects negative and non-integer forkAfterIndex without creating anything', async () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      await expect(createBranch(dataDir, STORY_ID, 'x', 'main', bad)).rejects.toThrow(/forkAfterIndex/)
    }
    const dirs = await readdir(join(dataDir, 'stories', STORY_ID, 'branches'))
    expect(dirs).toEqual(['main'])
    expect((await getBranchesIndex(dataDir, STORY_ID)).branches).toHaveLength(1)
  })

  it('concurrent branch creation keeps every branch in the index', async () => {
    await Promise.all(Array.from({ length: 5 }, (_, i) => createBranch(dataDir, STORY_ID, `b${i}`, 'main')))
    const index = await getBranchesIndex(dataDir, STORY_ID)
    expect(index.branches).toHaveLength(6)
    const dirs = await readdir(join(dataDir, 'stories', STORY_ID, 'branches'))
    expect(dirs).toHaveLength(6)
  })

  it('concurrent create + rename does not drop either change', async () => {
    const [branch] = await Promise.all([
      createBranch(dataDir, STORY_ID, 'fork', 'main'),
      renameBranch(dataDir, STORY_ID, 'main', 'Renamed'),
    ])
    const index = await getBranchesIndex(dataDir, STORY_ID)
    expect(index.branches.find((b) => b.id === 'main')?.name).toBe('Renamed')
    expect(index.branches.find((b) => b.id === branch.id)).toBeDefined()
  })
})
