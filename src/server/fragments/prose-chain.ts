import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ProseChain } from './schema'

const PROSE_CHAIN_FILE = 'prose-chain.json'

function proseChainPath(dataDir: string, storyId: string): string {
  return join(dataDir, 'stories', storyId, PROSE_CHAIN_FILE)
}

/**
 * Get the prose chain for a story.
 * Returns null if no chain exists yet.
 */
export async function getProseChain(
  dataDir: string,
  storyId: string,
): Promise<ProseChain | null> {
  const path = proseChainPath(dataDir, storyId)
  if (!existsSync(path)) {
    return null
  }
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as ProseChain
}

/**
 * Save the prose chain for a story.
 */
export async function saveProseChain(
  dataDir: string,
  storyId: string,
  chain: ProseChain,
): Promise<void> {
  const path = proseChainPath(dataDir, storyId)
  await writeFile(path, JSON.stringify(chain, null, 2), 'utf-8')
}

/**
 * Initialize a new prose chain with a single entry.
 */
export async function initProseChain(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<void> {
  const chain: ProseChain = {
    entries: [{
      proseFragments: [fragmentId],
      active: fragmentId,
    }],
  }
  await saveProseChain(dataDir, storyId, chain)
}

/**
 * Add a new prose section to the chain.
 * This creates a new entry at the end of the story.
 */
export async function addProseSection(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<void> {
  const chain = await getProseChain(dataDir, storyId)
  if (!chain) {
    await initProseChain(dataDir, storyId, fragmentId)
    return
  }

  chain.entries.push({
    proseFragments: [fragmentId],
    active: fragmentId,
  })
  await saveProseChain(dataDir, storyId, chain)
}

/**
 * Add a variation to an existing prose section.
 * Used when regenerating/refining - creates a new version of that section.
 * The new fragment becomes the active one.
 */
export async function addProseVariation(
  dataDir: string,
  storyId: string,
  sectionIndex: number,
  fragmentId: string,
): Promise<void> {
  const chain = await getProseChain(dataDir, storyId)
  if (!chain) {
    throw new Error(`No prose chain found for story ${storyId}`)
  }

  if (sectionIndex < 0 || sectionIndex >= chain.entries.length) {
    throw new Error(`Invalid section index ${sectionIndex}`)
  }

  const entry = chain.entries[sectionIndex]
  entry.proseFragments.push(fragmentId)
  entry.active = fragmentId
  await saveProseChain(dataDir, storyId, chain)
}

/**
 * Switch the active fragment for a prose section.
 * Used to revert to a previous version.
 */
export async function switchActiveProse(
  dataDir: string,
  storyId: string,
  sectionIndex: number,
  fragmentId: string,
): Promise<void> {
  const chain = await getProseChain(dataDir, storyId)
  if (!chain) {
    throw new Error(`No prose chain found for story ${storyId}`)
  }

  if (sectionIndex < 0 || sectionIndex >= chain.entries.length) {
    throw new Error(`Invalid section index ${sectionIndex}`)
  }

  const entry = chain.entries[sectionIndex]
  if (!entry.proseFragments.includes(fragmentId)) {
    throw new Error(`Fragment ${fragmentId} is not a variation of section ${sectionIndex}`)
  }

  entry.active = fragmentId
  await saveProseChain(dataDir, storyId, chain)
}

/**
 * Get all active prose fragment IDs in order.
 * This represents the current "timeline" of the story.
 */
export async function getActiveProseIds(
  dataDir: string,
  storyId: string,
): Promise<string[]> {
  const chain = await getProseChain(dataDir, storyId)
  if (!chain) {
    return []
  }

  return chain.entries.map(entry => entry.active)
}

/**
 * Get the full prose chain with all variations.
 */
export async function getFullProseChain(
  dataDir: string,
  storyId: string,
): Promise<ProseChain | null> {
  return getProseChain(dataDir, storyId)
}

/**
 * Remove a section from the prose chain by index.
 * Returns the fragment IDs that were in that section.
 */
export async function removeProseSection(
  dataDir: string,
  storyId: string,
  sectionIndex: number,
): Promise<string[]> {
  const chain = await getProseChain(dataDir, storyId)
  if (!chain) {
    throw new Error(`No prose chain found for story ${storyId}`)
  }

  if (sectionIndex < 0 || sectionIndex >= chain.entries.length) {
    throw new Error(`Invalid section index ${sectionIndex}`)
  }

  const removed = chain.entries.splice(sectionIndex, 1)[0]
  await saveProseChain(dataDir, storyId, chain)
  return removed.proseFragments
}

/**
 * Find the section index for a given fragment ID.
 * Returns -1 if not found.
 */
export async function findSectionIndex(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<number> {
  const chain = await getProseChain(dataDir, storyId)
  if (!chain) {
    return -1
  }

  return chain.entries.findIndex(entry => 
    entry.proseFragments.includes(fragmentId)
  )
}
