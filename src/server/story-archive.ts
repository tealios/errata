import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { zipSync, unzipSync } from 'fflate'
import { generateFragmentId } from '@/lib/fragment-ids'
import { createStory } from './fragments/storage'
import { saveProseChain } from './fragments/prose-chain'
import { saveAssociations } from './fragments/associations'
import type { StoryMeta, Fragment, Associations, ProseChain } from './fragments/schema'

export interface ExportOptions {
  includeLogs?: boolean
  includeLibrarian?: boolean
}

export interface ExportResult {
  buffer: Uint8Array
  filename: string
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

  // meta.json
  const metaPath = join(storyDir, 'meta.json')
  if (existsSync(metaPath)) {
    files['errata-story-export/meta.json'] = encoder.encode(
      await readFile(metaPath, 'utf-8'),
    )
  }

  // prose-chain.json
  const proseChainPath = join(storyDir, 'prose-chain.json')
  if (existsSync(proseChainPath)) {
    files['errata-story-export/prose-chain.json'] = encoder.encode(
      await readFile(proseChainPath, 'utf-8'),
    )
  }

  // associations.json
  const assocPath = join(storyDir, 'associations.json')
  if (existsSync(assocPath)) {
    files['errata-story-export/associations.json'] = encoder.encode(
      await readFile(assocPath, 'utf-8'),
    )
  }

  // fragments/
  const fragmentsDir = join(storyDir, 'fragments')
  if (existsSync(fragmentsDir)) {
    const entries = await readdir(fragmentsDir)
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const content = await readFile(join(fragmentsDir, entry), 'utf-8')
      files[`errata-story-export/fragments/${entry}`] = encoder.encode(content)
    }
  }

  // generation-logs/ (optional)
  if (options.includeLogs) {
    const logsDir = join(storyDir, 'generation-logs')
    if (existsSync(logsDir)) {
      const entries = await readdir(logsDir)
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue
        const content = await readFile(join(logsDir, entry), 'utf-8')
        files[`errata-story-export/generation-logs/${entry}`] = encoder.encode(content)
      }
    }
  }

  // librarian/ (optional)
  if (options.includeLibrarian) {
    const libDir = join(storyDir, 'librarian')
    if (existsSync(libDir)) {
      // state.json
      const statePath = join(libDir, 'state.json')
      if (existsSync(statePath)) {
        files['errata-story-export/librarian/state.json'] = encoder.encode(
          await readFile(statePath, 'utf-8'),
        )
      }
      // analyses/
      const analysesDir = join(libDir, 'analyses')
      if (existsSync(analysesDir)) {
        const entries = await readdir(analysesDir)
        for (const entry of entries) {
          if (!entry.endsWith('.json')) continue
          const content = await readFile(join(analysesDir, entry), 'utf-8')
          files[`errata-story-export/librarian/analyses/${entry}`] = encoder.encode(content)
        }
      }
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

  // Read meta.json
  const metaKey = paths.find((p) => p.endsWith('meta.json') && !p.includes('fragments/'))
  if (!metaKey) {
    throw new Error('Invalid archive: missing meta.json')
  }
  const decoder = new TextDecoder()
  const originalMeta = JSON.parse(decoder.decode(extracted[metaKey])) as StoryMeta

  // Generate new story ID
  const newStoryId = `story-${Date.now().toString(36)}`
  const now = new Date().toISOString()

  // Collect all fragment files and build ID remap
  const idMap = new Map<string, string>() // oldId -> newId
  const fragmentFiles: Array<{ oldId: string; data: Fragment }> = []

  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('fragments/') || !path.endsWith('.json')) continue
    const fragment = JSON.parse(decoder.decode(content)) as Fragment
    const newId = generateFragmentId(fragment.type)
    idMap.set(fragment.id, newId)
    fragmentFiles.push({ oldId: fragment.id, data: fragment })
  }

  // Remap fragment IDs and cross-references
  const remappedFragments: Fragment[] = fragmentFiles.map(({ data }) => {
    const newId = idMap.get(data.id)!
    return {
      ...data,
      id: newId,
      refs: data.refs.map((ref) => idMap.get(ref) ?? ref),
      meta: remapMeta(data.meta, idMap),
    }
  })

  // Read and remap prose chain
  const proseChainKey = paths.find((p) => p.endsWith('prose-chain.json') && !p.includes('fragments/'))
  let remappedProseChain: ProseChain | null = null
  if (proseChainKey) {
    const proseChain = JSON.parse(decoder.decode(extracted[proseChainKey])) as ProseChain
    remappedProseChain = {
      entries: proseChain.entries.map((entry) => ({
        proseFragments: entry.proseFragments.map((id) => idMap.get(id) ?? id),
        active: idMap.get(entry.active) ?? entry.active,
      })),
    }
  }

  // Read and remap associations
  const assocKey = paths.find((p) => p.endsWith('associations.json') && !p.includes('fragments/'))
  let remappedAssociations: Associations | null = null
  if (assocKey) {
    const assoc = JSON.parse(decoder.decode(extracted[assocKey])) as Associations
    remappedAssociations = remapAssociations(assoc, idMap)
  }

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

  // Write to disk
  await createStory(dataDir, newMeta)

  // Write fragments directly (bulk)
  const fragmentsDir = join(dataDir, 'stories', newStoryId, 'fragments')
  await mkdir(fragmentsDir, { recursive: true })
  for (const fragment of remappedFragments) {
    await writeFile(
      join(fragmentsDir, `${fragment.id}.json`),
      JSON.stringify(fragment, null, 2),
      'utf-8',
    )
  }

  // Write prose chain
  if (remappedProseChain) {
    await saveProseChain(dataDir, newStoryId, remappedProseChain)
  }

  // Write associations
  if (remappedAssociations) {
    await saveAssociations(dataDir, newStoryId, remappedAssociations)
  }

  // Write generation logs (no ID remapping, just copy)
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('generation-logs/') || !path.endsWith('.json')) continue
    const logsDir = join(dataDir, 'stories', newStoryId, 'generation-logs')
    await mkdir(logsDir, { recursive: true })
    const filename = path.split('/').pop()!
    const logData = JSON.parse(decoder.decode(content))
    // Remap fragmentId if present
    if (logData.fragmentId && idMap.has(logData.fragmentId)) {
      logData.fragmentId = idMap.get(logData.fragmentId)
    }
    await writeFile(join(logsDir, filename), JSON.stringify(logData, null, 2), 'utf-8')
  }

  // Write librarian data (no ID remapping, just copy)
  for (const [path, content] of Object.entries(extracted)) {
    if (!path.includes('librarian/') || !path.endsWith('.json')) continue
    const relativePath = path.slice(path.indexOf('librarian/'))
    const targetPath = join(dataDir, 'stories', newStoryId, relativePath)
    const targetDir = targetPath.substring(0, targetPath.lastIndexOf('/'))
    await mkdir(targetDir, { recursive: true })
    await writeFile(targetPath, decoder.decode(content), 'utf-8')
  }

  return newMeta
}

// --- Helpers ---

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
