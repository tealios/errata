import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { zipSync, unzipSync } from 'fflate'
import { generateFragmentId } from '@/lib/fragment-ids'
import { createStory } from './fragments/storage'
import { saveProseChain } from './fragments/prose-chain'
import { saveAssociations } from './fragments/associations'
import { getBranchesIndex, getContentRoot } from './fragments/branches'
import type { StoryMeta, Fragment, Associations, ProseChain, BranchesIndex } from './fragments/schema'

export interface ExportResult {
  buffer: Uint8Array
  filename: string
}

// --- Zip helpers ---

/** Recursively collect all files under `dir` into the zip files map. */
async function addDirRecursive(
  files: Record<string, Uint8Array>,
  dirPath: string,
  zipPrefix: string,
): Promise<void> {
  if (!existsSync(dirPath)) return
  const entries = await readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    const zipPath = `${zipPrefix}/${entry.name}`
    if (entry.isDirectory()) {
      await addDirRecursive(files, fullPath, zipPath)
    } else {
      files[zipPath] = new Uint8Array(await readFile(fullPath))
    }
  }
}

// --- Export ---

export async function exportStoryAsZip(
  dataDir: string,
  storyId: string,
): Promise<ExportResult> {
  const storyDir = join(dataDir, 'stories', storyId)
  if (!existsSync(storyDir)) {
    throw new Error(`Story not found: ${storyId}`)
  }

  const files: Record<string, Uint8Array> = {}
  const zipRoot = 'errata-story-export'

  // Recursively add the entire story directory
  await addDirRecursive(files, storyDir, zipRoot)

  // Ensure branches.json reflects migrated state
  const branchesIndex = await getBranchesIndex(dataDir, storyId)
  files[`${zipRoot}/branches.json`] = new TextEncoder().encode(
    JSON.stringify(branchesIndex, null, 2),
  )

  const buffer = zipSync(files)

  // Read meta for filename
  let storyName = storyId
  const metaPath = join(storyDir, 'meta.json')
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as StoryMeta
      storyName = meta.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)
    } catch {
      // fallback to storyId
    }
  }

  return {
    buffer,
    filename: `errata-${storyName}.zip`,
  }
}

// --- Import ---

export async function importStoryFromZip(
  dataDir: string,
  zipBuffer: Uint8Array,
): Promise<StoryMeta> {
  const extracted = unzipSync(zipBuffer)

  const paths = Object.keys(extracted)
  const decoder = new TextDecoder()

  // Read meta.json (at export root, not inside branches/ or fragments/)
  const metaKey = paths.find((p) => p.endsWith('meta.json') && !p.includes('fragments/') && !p.includes('branches/'))
  if (!metaKey) {
    throw new Error('Invalid archive: missing meta.json')
  }
  const originalMeta = JSON.parse(decoder.decode(extracted[metaKey])) as StoryMeta

  // Generate new story ID
  const newStoryId = `story-${Date.now().toString(36)}`
  const now = new Date().toISOString()

  // Detect format: new (has branches.json at root) or legacy (root-level content)
  const branchesKey = paths.find(
    (p) => p.endsWith('branches.json') && !p.includes('fragments/') && !p.includes('/branches/'),
  )

  // Build new story meta
  const newMeta: StoryMeta = {
    ...originalMeta,
    id: newStoryId,
    name: originalMeta.name + ' (imported)',
    createdAt: now,
    updatedAt: now,
    settings: {
      ...originalMeta.settings,
      providerId: null,
      modelId: null,
    },
  }

  // Create story (sets up branches/main/ + branches.json)
  await createStory(dataDir, newMeta)

  if (branchesKey) {
    await importNewFormat(dataDir, newStoryId, extracted, decoder, branchesKey)
  } else {
    await importLegacyFormat(dataDir, newStoryId, extracted, paths, decoder)
  }

  return newMeta
}

// --- New format import (with branches/) ---

async function importNewFormat(
  dataDir: string,
  storyId: string,
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchesKey: string,
): Promise<void> {
  const storyDir = join(dataDir, 'stories', storyId)

  // Read branches.json from archive
  const branchesIndex = JSON.parse(decoder.decode(extracted[branchesKey])) as BranchesIndex

  // Collect ALL fragment IDs across all branches for consistent remapping
  const idMap = new Map<string, string>()
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('/branches/') || !path.includes('/fragments/') || !path.endsWith('.json')) continue
    const fragment = JSON.parse(decoder.decode(content)) as Fragment
    if (!idMap.has(fragment.id)) {
      idMap.set(fragment.id, generateFragmentId(fragment.type))
    }
  }

  // Write branches.json (overwrite the default one from createStory)
  await writeFile(join(storyDir, 'branches.json'), JSON.stringify(branchesIndex, null, 2), 'utf-8')

  // Write each branch
  for (const branch of branchesIndex.branches) {
    const branchPrefix = findBranchPrefix(Object.keys(extracted), branch.id)
    if (!branchPrefix) continue

    const bDir = join(storyDir, 'branches', branch.id)
    await mkdir(bDir, { recursive: true })
    await mkdir(join(bDir, 'fragments'), { recursive: true })

    // Track handled paths so we can copy remaining files verbatim
    const handled = new Set<string>()

    // Fragments (need ID remapping)
    await writeBranchFragments(extracted, decoder, branchPrefix, bDir, idMap, handled)

    // Prose chain (need ID remapping)
    await writeBranchProseChain(extracted, decoder, branchPrefix, bDir, idMap, handled)

    // Associations (need ID remapping)
    await writeBranchAssociations(extracted, decoder, branchPrefix, bDir, idMap, handled)

    // Generation logs (need fragmentId remapping)
    await writeBranchGenerationLogs(extracted, decoder, branchPrefix, bDir, idMap, handled)

    // Copy all remaining branch files verbatim (block-config, agent-blocks, librarian, etc.)
    await copyRemainingBranchFiles(extracted, branchPrefix, bDir, handled)
  }
}

// --- Legacy format import (root-level content) ---

async function importLegacyFormat(
  dataDir: string,
  storyId: string,
  extracted: Record<string, Uint8Array>,
  paths: string[],
  decoder: TextDecoder,
): Promise<void> {
  // Collect fragment IDs and build remap
  const idMap = new Map<string, string>()
  const fragmentFiles: Array<{ data: Fragment }> = []

  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('fragments/') || !path.endsWith('.json')) continue
    if (path.includes('/branches/')) continue
    const fragment = JSON.parse(decoder.decode(content)) as Fragment
    const newId = generateFragmentId(fragment.type)
    idMap.set(fragment.id, newId)
    fragmentFiles.push({ data: fragment })
  }

  // Remap fragments
  const remappedFragments: Fragment[] = fragmentFiles.map(({ data }) => {
    const newId = idMap.get(data.id)!
    return {
      ...data,
      id: newId,
      refs: data.refs.map((ref) => idMap.get(ref) ?? ref),
      meta: remapMeta(data.meta, idMap),
    }
  })

  // Write fragments to the active branch (main)
  const root = await getContentRoot(dataDir, storyId)
  const fragmentsDir = join(root, 'fragments')
  await mkdir(fragmentsDir, { recursive: true })
  for (const fragment of remappedFragments) {
    await writeFile(
      join(fragmentsDir, `${fragment.id}.json`),
      JSON.stringify(fragment, null, 2),
      'utf-8',
    )
  }

  // Prose chain
  const proseChainKey = paths.find((p) => p.endsWith('prose-chain.json') && !p.includes('fragments/') && !p.includes('branches/'))
  if (proseChainKey) {
    const proseChain = JSON.parse(decoder.decode(extracted[proseChainKey])) as ProseChain
    const remappedProseChain: ProseChain = {
      entries: proseChain.entries.map((entry) => ({
        proseFragments: entry.proseFragments.map((id) => idMap.get(id) ?? id),
        active: idMap.get(entry.active) ?? entry.active,
      })),
    }
    await saveProseChain(dataDir, storyId, remappedProseChain)
  }

  // Associations
  const assocKey = paths.find((p) => p.endsWith('associations.json') && !p.includes('fragments/') && !p.includes('branches/'))
  if (assocKey) {
    const assoc = JSON.parse(decoder.decode(extracted[assocKey])) as Associations
    await saveAssociations(dataDir, storyId, remapAssociations(assoc, idMap))
  }

  // Generation logs (remap fragmentId)
  const handledLegacy = new Set<string>()
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('generation-logs/') || !path.endsWith('.json')) continue
    if (path.includes('/branches/')) continue
    handledLegacy.add(path)
    const logsDir = join(root, 'generation-logs')
    await mkdir(logsDir, { recursive: true })
    const filename = path.split('/').pop()!
    const logData = JSON.parse(decoder.decode(content))
    if (logData.fragmentId && idMap.has(logData.fragmentId)) {
      logData.fragmentId = idMap.get(logData.fragmentId)
    }
    await writeFile(join(logsDir, filename), JSON.stringify(logData, null, 2), 'utf-8')
  }

  // Copy all remaining files verbatim (librarian, agent-blocks, block-config, etc.)
  // Find the export root prefix (e.g. "errata-story-export/")
  const rootPrefix = paths.find(p => p.endsWith('meta.json'))?.replace('meta.json', '') ?? ''
  for (const [path, content] of Object.entries(extracted)) {
    if (path.includes('/branches/')) continue
    if (!path.startsWith(rootPrefix)) continue
    const relativePath = path.slice(rootPrefix.length)
    // Skip files already handled above
    if (relativePath === 'meta.json' || relativePath === 'branches.json') continue
    if (relativePath.startsWith('fragments/')) continue
    if (relativePath === 'prose-chain.json' || relativePath === 'associations.json') continue
    if (handledLegacy.has(path)) continue
    const targetPath = join(root, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, content)
  }
}

// --- Branch content helpers ---

function findBranchPrefix(paths: string[], branchId: string): string | null {
  for (const p of paths) {
    const marker = `/branches/${branchId}/`
    const idx = p.indexOf(marker)
    if (idx !== -1) return p.substring(0, idx + marker.length - 1)
  }
  return null
}

async function writeBranchFragments(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
  handled: Set<string>,
): Promise<void> {
  const fragPrefix = branchPrefix + '/fragments/'
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(fragPrefix) || !path.endsWith('.json')) continue
    handled.add(path)
    const fragment = JSON.parse(decoder.decode(content)) as Fragment
    const newId = idMap.get(fragment.id) ?? fragment.id
    const remapped: Fragment = {
      ...fragment,
      id: newId,
      refs: fragment.refs.map((ref) => idMap.get(ref) ?? ref),
      meta: remapMeta(fragment.meta, idMap),
    }
    await writeFile(
      join(bDir, 'fragments', `${newId}.json`),
      JSON.stringify(remapped, null, 2),
      'utf-8',
    )
  }
}

async function writeBranchProseChain(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
  handled: Set<string>,
): Promise<void> {
  const key = `${branchPrefix}/prose-chain.json`
  if (!extracted[key]) return
  handled.add(key)
  const chain = JSON.parse(decoder.decode(extracted[key])) as ProseChain
  const remapped: ProseChain = {
    entries: chain.entries.map((entry) => ({
      proseFragments: entry.proseFragments.map((id) => idMap.get(id) ?? id),
      active: idMap.get(entry.active) ?? entry.active,
    })),
  }
  await writeFile(join(bDir, 'prose-chain.json'), JSON.stringify(remapped, null, 2), 'utf-8')
}

async function writeBranchAssociations(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
  handled: Set<string>,
): Promise<void> {
  const key = `${branchPrefix}/associations.json`
  if (!extracted[key]) return
  handled.add(key)
  const assoc = JSON.parse(decoder.decode(extracted[key])) as Associations
  const remapped = remapAssociations(assoc, idMap)
  await writeFile(join(bDir, 'associations.json'), JSON.stringify(remapped, null, 2), 'utf-8')
}

async function writeBranchGenerationLogs(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
  handled: Set<string>,
): Promise<void> {
  const prefix = `${branchPrefix}/generation-logs/`
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(prefix) || !path.endsWith('.json')) continue
    handled.add(path)
    const logData = JSON.parse(decoder.decode(content))
    if (logData.fragmentId && idMap.has(logData.fragmentId)) {
      logData.fragmentId = idMap.get(logData.fragmentId)
    }
    const logsDir = join(bDir, 'generation-logs')
    await mkdir(logsDir, { recursive: true })
    const filename = path.split('/').pop()!
    await writeFile(join(logsDir, filename), JSON.stringify(logData, null, 2), 'utf-8')
  }
}

/** Copy all branch files that weren't handled by the specific importers above. */
async function copyRemainingBranchFiles(
  extracted: Record<string, Uint8Array>,
  branchPrefix: string,
  bDir: string,
  handled: Set<string>,
): Promise<void> {
  const prefix = branchPrefix + '/'
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(prefix) || handled.has(path)) continue
    const relativePath = path.slice(prefix.length)
    const targetPath = join(bDir, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, content)
  }
}

// --- ID remapping helpers ---

function remapMeta(
  meta: Record<string, unknown>,
  idMap: Map<string, string>,
): Record<string, unknown> {
  const result = { ...meta }

  // Remap visualRefs[].fragmentId
  if (Array.isArray(result.visualRefs)) {
    result.visualRefs = (result.visualRefs as Array<Record<string, unknown>>).map((ref) => ({
      ...ref,
      fragmentId: idMap.get(ref.fragmentId as string) ?? ref.fragmentId,
    }))
  }

  // Remap previousFragmentId
  if (typeof result.previousFragmentId === 'string' && idMap.has(result.previousFragmentId)) {
    result.previousFragmentId = idMap.get(result.previousFragmentId)
  }

  // Remap variationOf
  if (typeof result.variationOf === 'string' && idMap.has(result.variationOf)) {
    result.variationOf = idMap.get(result.variationOf)
  }

  return result
}

function remapAssociations(
  assoc: Associations,
  idMap: Map<string, string>,
): Associations {
  const newTagIndex: Record<string, string[]> = {}
  for (const [tag, ids] of Object.entries(assoc.tagIndex)) {
    newTagIndex[tag] = ids.map((id) => idMap.get(id) ?? id)
  }

  const newRefIndex: Record<string, string[]> = {}
  for (const [key, ids] of Object.entries(assoc.refIndex)) {
    let newKey = key
    // Remap __backref: keys
    if (key.startsWith('__backref:')) {
      const oldId = key.slice('__backref:'.length)
      const newId = idMap.get(oldId) ?? oldId
      newKey = `__backref:${newId}`
    } else if (idMap.has(key)) {
      newKey = idMap.get(key)!
    }
    newRefIndex[newKey] = ids.map((id) => idMap.get(id) ?? id)
  }

  return { tagIndex: newTagIndex, refIndex: newRefIndex }
}
