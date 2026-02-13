import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { AssociationsSchema, type Associations } from './schema'

function associationsPath(dataDir: string, storyId: string): string {
  return join(dataDir, 'stories', storyId, 'associations.json')
}

export async function getAssociations(
  dataDir: string,
  storyId: string
): Promise<Associations> {
  const path = associationsPath(dataDir, storyId)
  if (!existsSync(path)) {
    return { tagIndex: {}, refIndex: {} }
  }
  const raw = await readFile(path, 'utf-8')
  return AssociationsSchema.parse(JSON.parse(raw))
}

async function saveAssociations(
  dataDir: string,
  storyId: string,
  assoc: Associations
): Promise<void> {
  const path = associationsPath(dataDir, storyId)
  await writeFile(path, JSON.stringify(assoc, null, 2), 'utf-8')
}

// --- Tag operations ---

export async function addTag(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  tag: string
): Promise<void> {
  const assoc = await getAssociations(dataDir, storyId)
  if (!assoc.tagIndex[tag]) {
    assoc.tagIndex[tag] = []
  }
  if (!assoc.tagIndex[tag].includes(fragmentId)) {
    assoc.tagIndex[tag].push(fragmentId)
  }
  await saveAssociations(dataDir, storyId, assoc)
}

export async function removeTag(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  tag: string
): Promise<void> {
  const assoc = await getAssociations(dataDir, storyId)
  if (assoc.tagIndex[tag]) {
    assoc.tagIndex[tag] = assoc.tagIndex[tag].filter((id) => id !== fragmentId)
    if (assoc.tagIndex[tag].length === 0) {
      delete assoc.tagIndex[tag]
    }
  }
  await saveAssociations(dataDir, storyId, assoc)
}

export async function getFragmentsByTag(
  dataDir: string,
  storyId: string,
  tag: string
): Promise<string[]> {
  const assoc = await getAssociations(dataDir, storyId)
  return assoc.tagIndex[tag] ?? []
}

// --- Ref operations ---

export async function addRef(
  dataDir: string,
  storyId: string,
  fromId: string,
  toId: string
): Promise<void> {
  const assoc = await getAssociations(dataDir, storyId)

  // Forward ref
  if (!assoc.refIndex[fromId]) {
    assoc.refIndex[fromId] = []
  }
  if (!assoc.refIndex[fromId].includes(toId)) {
    assoc.refIndex[fromId].push(toId)
  }

  // Back-ref (stored under a __backref:<id> key)
  const backKey = `__backref:${toId}`
  if (!assoc.refIndex[backKey]) {
    assoc.refIndex[backKey] = []
  }
  if (!assoc.refIndex[backKey].includes(fromId)) {
    assoc.refIndex[backKey].push(fromId)
  }

  await saveAssociations(dataDir, storyId, assoc)
}

export async function removeRef(
  dataDir: string,
  storyId: string,
  fromId: string,
  toId: string
): Promise<void> {
  const assoc = await getAssociations(dataDir, storyId)

  // Forward ref
  if (assoc.refIndex[fromId]) {
    assoc.refIndex[fromId] = assoc.refIndex[fromId].filter((id) => id !== toId)
    if (assoc.refIndex[fromId].length === 0) {
      delete assoc.refIndex[fromId]
    }
  }

  // Back-ref
  const backKey = `__backref:${toId}`
  if (assoc.refIndex[backKey]) {
    assoc.refIndex[backKey] = assoc.refIndex[backKey].filter(
      (id) => id !== fromId
    )
    if (assoc.refIndex[backKey].length === 0) {
      delete assoc.refIndex[backKey]
    }
  }

  await saveAssociations(dataDir, storyId, assoc)
}

export async function getRefs(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<string[]> {
  const assoc = await getAssociations(dataDir, storyId)
  return assoc.refIndex[fragmentId] ?? []
}

export async function getBackRefs(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<string[]> {
  const assoc = await getAssociations(dataDir, storyId)
  return assoc.refIndex[`__backref:${fragmentId}`] ?? []
}
