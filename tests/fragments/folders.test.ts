import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory, createFragment } from '@/server/fragments/storage'
import {
  listFolders,
  getFolder,
  createFolder,
  updateFolder,
  deleteFolder,
  reorderFolders,
  getAssignments,
  assignFragment,
  assignFragmentsBulk,
} from '@/server/fragments/folders'
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
  coverImage: null,
  summary: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: makeTestSettings(),
  ...overrides,
})

const makeFragment = (overrides: Partial<Fragment> = {}): Fragment => ({
  id: 'ch-a1b2c3',
  type: 'character',
  name: 'Test Character',
  description: 'A test character',
  content: 'Character details',
  tags: [],
  refs: [],
  sticky: false,
  placement: 'user' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  order: 0,
  meta: {},
  archived: false,
  version: 1,
  versions: [],
  ...overrides,
})

describe('folders', () => {
  beforeEach(async () => {
    await createStory(dataDir, makeStory())
  })

  it('lists empty folders for new story', async () => {
    const folders = await listFolders(dataDir, 'story-1')
    expect(folders).toEqual([])
  })

  it('creates a folder', async () => {
    const folder = await createFolder(dataDir, 'story-1', 'Characters')
    expect(folder.name).toBe('Characters')
    expect(folder.order).toBe(0)
    expect(folder.id).toMatch(/^fld-/)
  })

  it('lists folders sorted by order', async () => {
    await createFolder(dataDir, 'story-1', 'B Folder')
    await createFolder(dataDir, 'story-1', 'A Folder')
    const folders = await listFolders(dataDir, 'story-1')
    expect(folders).toHaveLength(2)
    expect(folders[0].name).toBe('B Folder')
    expect(folders[1].name).toBe('A Folder')
    expect(folders[0].order).toBe(0)
    expect(folders[1].order).toBe(1)
  })

  it('gets a folder by id', async () => {
    const created = await createFolder(dataDir, 'story-1', 'My Folder')
    const folder = await getFolder(dataDir, 'story-1', created.id)
    expect(folder).toEqual(created)
  })

  it('returns null for nonexistent folder', async () => {
    const folder = await getFolder(dataDir, 'story-1', 'fld-nonexistent')
    expect(folder).toBeNull()
  })

  it('updates folder name', async () => {
    const created = await createFolder(dataDir, 'story-1', 'Old Name')
    const updated = await updateFolder(dataDir, 'story-1', created.id, { name: 'New Name' })
    expect(updated?.name).toBe('New Name')

    const fetched = await getFolder(dataDir, 'story-1', created.id)
    expect(fetched?.name).toBe('New Name')
  })

  it('updates folder color', async () => {
    const created = await createFolder(dataDir, 'story-1', 'Colored')
    const updated = await updateFolder(dataDir, 'story-1', created.id, { color: '#ff0000' })
    expect(updated?.color).toBe('#ff0000')

    // Clear color
    const cleared = await updateFolder(dataDir, 'story-1', created.id, { color: null })
    expect(cleared?.color).toBeUndefined()
  })

  it('returns null when updating nonexistent folder', async () => {
    const result = await updateFolder(dataDir, 'story-1', 'fld-nope', { name: 'X' })
    expect(result).toBeNull()
  })

  it('deletes a folder', async () => {
    const created = await createFolder(dataDir, 'story-1', 'Doomed')
    const ok = await deleteFolder(dataDir, 'story-1', created.id)
    expect(ok).toBe(true)

    const folders = await listFolders(dataDir, 'story-1')
    expect(folders).toHaveLength(0)
  })

  it('returns false when deleting nonexistent folder', async () => {
    const ok = await deleteFolder(dataDir, 'story-1', 'fld-nope')
    expect(ok).toBe(false)
  })

  it('deleting a folder clears its assignments', async () => {
    const folder = await createFolder(dataDir, 'story-1', 'Characters')
    await assignFragment(dataDir, 'story-1', 'ch-a1b2c3', folder.id)

    await deleteFolder(dataDir, 'story-1', folder.id)

    const assignments = await getAssignments(dataDir, 'story-1')
    expect(assignments['ch-a1b2c3']).toBeUndefined()
  })

  it('reorders folders', async () => {
    const a = await createFolder(dataDir, 'story-1', 'A')
    const b = await createFolder(dataDir, 'story-1', 'B')
    const c = await createFolder(dataDir, 'story-1', 'C')

    await reorderFolders(dataDir, 'story-1', [
      { id: c.id, order: 0 },
      { id: a.id, order: 1 },
      { id: b.id, order: 2 },
    ])

    const folders = await listFolders(dataDir, 'story-1')
    expect(folders[0].name).toBe('C')
    expect(folders[1].name).toBe('A')
    expect(folders[2].name).toBe('B')
  })

  it('assigns a fragment to a folder', async () => {
    const folder = await createFolder(dataDir, 'story-1', 'My Folder')
    await assignFragment(dataDir, 'story-1', 'ch-a1b2c3', folder.id)

    const assignments = await getAssignments(dataDir, 'story-1')
    expect(assignments['ch-a1b2c3']).toBe(folder.id)
  })

  it('unassigns a fragment from a folder', async () => {
    const folder = await createFolder(dataDir, 'story-1', 'My Folder')
    await assignFragment(dataDir, 'story-1', 'ch-a1b2c3', folder.id)
    await assignFragment(dataDir, 'story-1', 'ch-a1b2c3', null)

    const assignments = await getAssignments(dataDir, 'story-1')
    expect(assignments['ch-a1b2c3']).toBeUndefined()
  })

  it('bulk assigns fragments', async () => {
    const folderA = await createFolder(dataDir, 'story-1', 'A')
    const folderB = await createFolder(dataDir, 'story-1', 'B')
    await assignFragmentsBulk(dataDir, 'story-1', [
      { fragmentId: 'ch-aaa', folderId: folderA.id },
      { fragmentId: 'ch-bbb', folderId: folderB.id },
      { fragmentId: 'ch-ccc', folderId: folderA.id },
    ])

    const assignments = await getAssignments(dataDir, 'story-1')
    expect(assignments['ch-aaa']).toBe(folderA.id)
    expect(assignments['ch-bbb']).toBe(folderB.id)
    expect(assignments['ch-ccc']).toBe(folderA.id)
  })

  it('empty assignments for new story', async () => {
    const assignments = await getAssignments(dataDir, 'story-1')
    expect(assignments).toEqual({})
  })

  it('migrates old folders.json without assignments field', async () => {
    // Simulate old format
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const path = join(dataDir, 'stories', 'story-1', 'folders.json')
    await writeFile(path, JSON.stringify({ folders: [{ id: 'fld-test', name: 'Old', order: 0 }] }))

    const folders = await listFolders(dataDir, 'story-1')
    expect(folders).toHaveLength(1)
    const assignments = await getAssignments(dataDir, 'story-1')
    expect(assignments).toEqual({})
  })
})
