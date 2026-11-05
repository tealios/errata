import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { AssociationsSchema, type Associations } from './schema'
import { mutateFragment } from './storage'
import { createLogger } from '../logging/logger'
import { getContentRoot } from './branches'
import { writeJsonAtomic } from '../fs-utils'
import { withKeyLock } from '../async-lock'

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
  await writeJsonAtomic(path, assoc)
}

// --- Tag operations ---

export async function addTag(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  tag: string
): Promise<void> {
  return withKeyLock(`associations:${dataDir}:${storyId}`, async () => {
    const assoc = await getAssociations(dataDir, storyId)
    if (!assoc.tagIndex[tag]) {
      assoc.tagIndex[tag] = []
    }
    if (!assoc.tagIndex[tag].includes(fragmentId)) {
      assoc.tagIndex[tag].push(fragmentId)
    }
    await Promise.all([
      saveAssociations(dataDir, storyId, assoc),
      (async () => {
        const updated = await mutateFragment(dataDir, storyId, fragmentId, (fragment) => {
          if (fragment.tags.includes(tag)) return fragment
          return { ...fragment, tags: [...fragment.tags, tag], updatedAt: new Date().toISOString() }
        })
        if (!updated) log.warn(`Cannot add tag: fragment not found`, { storyId, fragmentId, tag })
      })(),
    ])
  })
}

export async function removeTag(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  tag: string
): Promise<void> {
  return withKeyLock(`associations:${dataDir}:${storyId}`, async () => {
    const assoc = await getAssociations(dataDir, storyId)
    if (assoc.tagIndex[tag]) {
      assoc.tagIndex[tag] = assoc.tagIndex[tag].filter((id) => id !== fragmentId)
      if (assoc.tagIndex[tag].length === 0) {
        delete assoc.tagIndex[tag]
      }
    }
    await Promise.all([
      saveAssociations(dataDir, storyId, assoc),
      (async () => {
        const updated = await mutateFragment(dataDir, storyId, fragmentId, (fragment) => {
          if (!fragment.tags.includes(tag)) return fragment
          return { ...fragment, tags: fragment.tags.filter((t) => t !== tag), updatedAt: new Date().toISOString() }
        })
        if (!updated) log.warn(`Cannot remove tag: fragment not found`, { storyId, fragmentId, tag })
      })(),
    ])
  })
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
  return withKeyLock(`associations:${dataDir}:${storyId}`, async () => {
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
  })
}

export async function removeRef(
  dataDir: string,
  storyId: string,
  fromId: string,
  toId: string
): Promise<void> {
  return withKeyLock(`associations:${dataDir}:${storyId}`, async () => {
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
  })
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
