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

export interface ExportOptions {
  includeLogs?: boolean
  includeLibrarian?: boolean
}

export interface ExportResult {
  buffer: Uint8Array
  filename: string
}

// --- Zip helpers ---

async function addFileIfExists(
  files: Record<string, Uint8Array>,
  encoder: TextEncoder,
  filePath: string,
  zipPath: string,
): Promise<void> {
  if (existsSync(filePath)) {
    files[zipPath] = encoder.encode(await readFile(filePath, 'utf-8'))
  }
}

async function addDirJsonFiles(
  files: Record<string, Uint8Array>,
  encoder: TextEncoder,
  dirPath: string,
  zipPrefix: string,
): Promise<void> {
  if (!existsSync(dirPath)) return
  const entries = await readdir(dirPath)
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const content = await readFile(join(dirPath, entry), 'utf-8')
    files[`${zipPrefix}/${entry}`] = encoder.encode(content)
  }
}

// --- Export ---

export async function exportStoryAsZip(
  dataDir: string,
  storyId: string,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const storyDir = join(dataDir, 'stories', storyId)
  if (!existsSync(storyDir)) {
    throw new Error(`Story not found: ${storyId}`)
  }

  const files: Record<string, Uint8Array> = {}
  const encoder = new TextEncoder()

  // meta.json (always at story root)
  const metaPath = join(storyDir, 'meta.json')
  await addFileIfExists(files, encoder, metaPath, 'errata-story-export/meta.json')

  // Ensure migration + get branch index
  const branchesIndex = await getBranchesIndex(dataDir, storyId)
  files['errata-story-export/branches.json'] = encoder.encode(
    JSON.stringify(branchesIndex, null, 2),
  )

  // Export each branch
  for (const branch of branchesIndex.branches) {
    const bDir = join(storyDir, 'branches', branch.id)
    if (!existsSync(bDir)) continue

    const prefix = `errata-story-export/branches/${branch.id}`

    await addFileIfExists(files, encoder, join(bDir, 'prose-chain.json'), `${prefix}/prose-chain.json`)
    await addFileIfExists(files, encoder, join(bDir, 'associations.json'), `${prefix}/associations.json`)
    await addFileIfExists(files, encoder, join(bDir, 'block-config.json'), `${prefix}/block-config.json`)

    // fragments/
    await addDirJsonFiles(files, encoder, join(bDir, 'fragments'), `${prefix}/fragments`)

    // generation-logs/ (optional)
    if (options.includeLogs) {
      await addDirJsonFiles(files, encoder, join(bDir, 'generation-logs'), `${prefix}/generation-logs`)
    }

    // librarian/ (optional)
    if (options.includeLibrarian) {
      await addFileIfExists(files, encoder, join(bDir, 'librarian', 'state.json'), `${prefix}/librarian/state.json`)
      await addDirJsonFiles(files, encoder, join(bDir, 'librarian', 'analyses'), `${prefix}/librarian/analyses`)
    }
  }

  const buffer = zipSync(files)

  // Read meta for filename
  let storyName = storyId
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

    // Fragments
    await writeBranchFragments(extracted, decoder, branchPrefix, bDir, idMap)

    // Prose chain
    await writeBranchProseChain(extracted, decoder, branchPrefix, bDir, idMap)

    // Associations
    await writeBranchAssociations(extracted, decoder, branchPrefix, bDir, idMap)

    // Block config (no remapping needed)
    await copyBranchFile(extracted, decoder, branchPrefix, bDir, 'block-config.json')

    // Generation logs
    await writeBranchGenerationLogs(extracted, decoder, branchPrefix, bDir, idMap)

    // Librarian data
    await writeBranchLibrarianData(extracted, decoder, branchPrefix, bDir)
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

  // Generation logs
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('generation-logs/') || !path.endsWith('.json')) continue
    if (path.includes('/branches/')) continue
    const logsDir = join(root, 'generation-logs')
    await mkdir(logsDir, { recursive: true })
    const filename = path.split('/').pop()!
    const logData = JSON.parse(decoder.decode(content))
    if (logData.fragmentId && idMap.has(logData.fragmentId)) {
      logData.fragmentId = idMap.get(logData.fragmentId)
    }
    await writeFile(join(logsDir, filename), JSON.stringify(logData, null, 2), 'utf-8')
  }

  // Librarian
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('librarian/') || !path.endsWith('.json')) continue
    if (path.includes('/branches/')) continue
    const relativePath = path.slice(path.indexOf('librarian/'))
    const targetPath = join(root, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, decoder.decode(content), 'utf-8')
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
): Promise<void> {
  const fragPrefix = branchPrefix + '/fragments/'
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.startsWith(fragPrefix) || !path.endsWith('.json')) continue
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
): Promise<void> {
  const key = `${branchPrefix}/prose-chain.json`
  if (!extracted[key]) return
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
): Promise<void> {
  const key = `${branchPrefix}/associations.json`
  if (!extracted[key]) return
  const assoc = JSON.parse(decoder.decode(extracted[key])) as Associations
  const remapped = remapAssociations(assoc, idMap)
  await writeFile(join(bDir, 'associations.json'), JSON.stringify(remapped, null, 2), 'utf-8')
}

async function copyBranchFile(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  filename: string,
): Promise<void> {
  const key = `${branchPrefix}/${filename}`
  if (!extracted[key]) return
  await writeFile(join(bDir, filename), decoder.decode(extracted[key]), 'utf-8')
}

async function writeBranchGenerationLogs(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
  idMap: Map<string, string>,
): Promise<void> {
  const prefix = `${branchPrefix}/generation-logs/`
  const logEntries = Object.entries(extracted).filter(
    ([p]) => p.startsWith(prefix) && p.endsWith('.json'),
  )
  if (logEntries.length === 0) return

  const logsDir = join(bDir, 'generation-logs')
  await mkdir(logsDir, { recursive: true })

  for (const [path, content] of logEntries) {
    const filename = path.split('/').pop()!
    const logData = JSON.parse(decoder.decode(content))
    if (logData.fragmentId && idMap.has(logData.fragmentId)) {
      logData.fragmentId = idMap.get(logData.fragmentId)
    }
    await writeFile(join(logsDir, filename), JSON.stringify(logData, null, 2), 'utf-8')
  }
}

async function writeBranchLibrarianData(
  extracted: Record<string, Uint8Array>,
  decoder: TextDecoder,
  branchPrefix: string,
  bDir: string,
): Promise<void> {
  const prefix = `${branchPrefix}/librarian/`
  const libEntries = Object.entries(extracted).filter(
    ([p]) => p.startsWith(prefix) && p.endsWith('.json'),
  )
  if (libEntries.length === 0) return

  for (const [path, content] of libEntries) {
    // e.g., "librarian/state.json" or "librarian/analyses/xxx.json"
    const relativePath = path.slice(branchPrefix.length + 1)
    const targetPath = join(bDir, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, decoder.decode(content), 'utf-8')
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
