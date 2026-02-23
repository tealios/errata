import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { generateFolderId } from '@/lib/fragment-ids'

export interface Folder {
  id: string
  name: string
  order: number
  color?: string
}

/** Fragment ID → Folder ID */
export type FolderAssignments = Record<string, string>

interface FoldersIndex {
  folders: Folder[]
  assignments: FolderAssignments
}

function foldersPath(dataDir: string, storyId: string): string {
  return join(dataDir, 'stories', storyId, 'folders.json')
}

async function readIndex(dataDir: string, storyId: string): Promise<FoldersIndex> {
  const path = foldersPath(dataDir, storyId)
  if (!existsSync(path)) return { folders: [], assignments: {} }
  const raw = await readFile(path, 'utf-8')
  const parsed = JSON.parse(raw) as Partial<FoldersIndex>
  return {
    folders: parsed.folders ?? [],
    assignments: parsed.assignments ?? {},
  }
}

async function writeIndex(dataDir: string, storyId: string, index: FoldersIndex): Promise<void> {
  const path = foldersPath(dataDir, storyId)
  await writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
}

export async function listFolders(dataDir: string, storyId: string): Promise<Folder[]> {
  const index = await readIndex(dataDir, storyId)
  return index.folders.sort((a, b) => a.order - b.order)
}

export async function getFolder(dataDir: string, storyId: string, folderId: string): Promise<Folder | null> {
  const index = await readIndex(dataDir, storyId)
  return index.folders.find((f) => f.id === folderId) ?? null
}

export async function createFolder(dataDir: string, storyId: string, name: string): Promise<Folder> {
  const index = await readIndex(dataDir, storyId)
  const maxOrder = index.folders.reduce((max, f) => Math.max(max, f.order), -1)
  const folder: Folder = {
    id: generateFolderId(),
    name,
    order: maxOrder + 1,
  }
  index.folders.push(folder)
  await writeIndex(dataDir, storyId, index)
  return folder
}

export async function updateFolder(
  dataDir: string,
  storyId: string,
  folderId: string,
  updates: { name?: string; color?: string | null },
): Promise<Folder | null> {
  const index = await readIndex(dataDir, storyId)
  const folder = index.folders.find((f) => f.id === folderId)
  if (!folder) return null

  if (updates.name !== undefined) folder.name = updates.name
  if (updates.color !== undefined) {
    if (updates.color === null) {
      delete folder.color
    } else {
      folder.color = updates.color
    }
  }

  await writeIndex(dataDir, storyId, index)
  return folder
}

export async function deleteFolder(dataDir: string, storyId: string, folderId: string): Promise<boolean> {
  const index = await readIndex(dataDir, storyId)
  const idx = index.folders.findIndex((f) => f.id === folderId)
  if (idx === -1) return false

  index.folders.splice(idx, 1)

  // Remove all assignments pointing to this folder
  for (const [fragId, assignedFolder] of Object.entries(index.assignments)) {
    if (assignedFolder === folderId) {
      delete index.assignments[fragId]
    }
  }

  await writeIndex(dataDir, storyId, index)
  return true
}

export async function reorderFolders(
  dataDir: string,
  storyId: string,
  items: Array<{ id: string; order: number }>,
): Promise<void> {
  const index = await readIndex(dataDir, storyId)
  const orderMap = new Map(items.map((item) => [item.id, item.order]))
  for (const folder of index.folders) {
    const newOrder = orderMap.get(folder.id)
    if (newOrder !== undefined) folder.order = newOrder
  }
  index.folders.sort((a, b) => a.order - b.order)
  await writeIndex(dataDir, storyId, index)
}

export async function getAssignments(dataDir: string, storyId: string): Promise<FolderAssignments> {
  const index = await readIndex(dataDir, storyId)
  return index.assignments
}

export async function assignFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  folderId: string | null,
): Promise<void> {
  const index = await readIndex(dataDir, storyId)
  if (folderId === null) {
    delete index.assignments[fragmentId]
  } else {
    index.assignments[fragmentId] = folderId
  }
  await writeIndex(dataDir, storyId, index)
}

export async function assignFragmentsBulk(
  dataDir: string,
  storyId: string,
  assignments: Array<{ fragmentId: string; folderId: string | null }>,
): Promise<void> {
  const index = await readIndex(dataDir, storyId)
  for (const { fragmentId, folderId } of assignments) {
    if (folderId === null) {
      delete index.assignments[fragmentId]
    } else {
      index.assignments[fragmentId] = folderId
    }
  }
  await writeIndex(dataDir, storyId, index)
}
