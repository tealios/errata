import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { AssociationsSchema, type Associations } from './schema'
import { getFragment, updateFragment } from './storage'
import { createLogger } from '../logging/logger'
import { getContentRoot } from './branches'

const log = createLogger('tags')

async function associationsPath(dataDir: string, storyId: string): Promise<string> {
  const root = await getContentRoot(dataDir, storyId)
  return join(root, 'associations.json')
}

export async function getAssociations(
  dataDir: string,
  storyId: string
): Promise<Associations> {
  const path = await associationsPath(dataDir, storyId)
  if (!existsSync(path)) {
    return { tagIndex: {}, refIndex: {} }
  }
  const raw = await readFile(path, 'utf-8')
  return AssociationsSchema.parse(JSON.parse(raw))
}

export async function saveAssociations(
  dataDir: string,
  storyId: string,
  assoc: Associations
): Promise<void> {
  const path = await associationsPath(dataDir, storyId)
  await writeFile(path, JSON.stringify(assoc, null, 2), 'utf-8')
}

// --- Fragment tag sync ---

async function addFragmentTag(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  tag: string
): Promise<void> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) {
    log.warn(`Cannot add tag: fragment not found`, { storyId, fragmentId, tag })
    return
  }
  if (fragment.tags.includes(tag)) return
  fragment.tags.push(tag)
  fragment.updatedAt = new Date().toISOString()
  await updateFragment(dataDir, storyId, fragment)
}

async function removeFragmentTag(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  tag: string
): Promise<void> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) {
    log.warn(`Cannot remove tag: fragment not found`, { storyId, fragmentId, tag })
    return
  }
  if (!fragment.tags.includes(tag)) return
  fragment.tags = fragment.tags.filter(t => t !== tag)
  fragment.updatedAt = new Date().toISOString()
  await updateFragment(dataDir, storyId, fragment)
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
  await Promise.all([
    saveAssociations(dataDir, storyId, assoc),
    addFragmentTag(dataDir, storyId, fragmentId, tag),
  ])
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
  await Promise.all([
    saveAssociations(dataDir, storyId, assoc),
    removeFragmentTag(dataDir, storyId, fragmentId, tag),
  ])
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
