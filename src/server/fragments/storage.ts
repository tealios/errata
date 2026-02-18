import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Fragment, FragmentVersion, StoryMeta } from './schema'
import { PREFIXES } from '@/lib/fragment-ids'
import { getContentRoot, initBranches } from './branches'
import { createLogger } from '../logging'

const requestLogger = createLogger('fragment-storage')

// --- Path helpers ---

function storiesDir(dataDir: string) {
  return join(dataDir, 'stories')
}

function storyDir(dataDir: string, storyId: string) {
  return join(storiesDir(dataDir), storyId)
}

function storyMetaPath(dataDir: string, storyId: string) {
  return join(storyDir(dataDir, storyId), 'meta.json')
}

async function fragmentsDir(dataDir: string, storyId: string) {
  const root = await getContentRoot(dataDir, storyId)
  return join(root, 'fragments')
}

async function fragmentPath(dataDir: string, storyId: string, fragmentId: string) {
  const dir = await fragmentsDir(dataDir, storyId)
  return join(dir, `${fragmentId}.json`)
}

// --- JSON read/write helpers ---

async function readJson<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as T
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

function normalizeFragment(fragment: Fragment | null): Fragment | null {
  if (!fragment) return null
  return {
    ...fragment,
    archived: fragment.archived ?? false,
    version: fragment.version ?? 1,
    versions: Array.isArray(fragment.versions) ? fragment.versions : [],
  }
}

function makeVersionSnapshot(fragment: Fragment, reason?: string): FragmentVersion {
  return {
    version: fragment.version,
    name: fragment.name,
    description: fragment.description,
    content: fragment.content,
    createdAt: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  }
}

// --- Story CRUD ---

export async function createStory(
  dataDir: string,
  story: StoryMeta
): Promise<void> {
  const dir = storyDir(dataDir, story.id)
  await mkdir(dir, { recursive: true })
  await initBranches(dataDir, story.id)
  await writeJson(storyMetaPath(dataDir, story.id), story)
}

export async function getStory(
  dataDir: string,
  storyId: string
): Promise<StoryMeta | null> {
  return readJson<StoryMeta>(storyMetaPath(dataDir, storyId))
}

export async function listStories(dataDir: string): Promise<StoryMeta[]> {
  const dir = storiesDir(dataDir)
  if (!existsSync(dir)) return []

  const entries = await readdir(dir, { withFileTypes: true })
  const stories: StoryMeta[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const meta = await getStory(dataDir, entry.name)
      if (meta) stories.push(meta)
    }
  }

  return stories
}

export async function updateStory(
  dataDir: string,
  story: StoryMeta
): Promise<void> {
  await writeJson(storyMetaPath(dataDir, story.id), story)
}

export async function deleteStory(
  dataDir: string,
  storyId: string
): Promise<void> {
  const dir = storyDir(dataDir, storyId)
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true })
  }
}

// --- Fragment CRUD ---

export async function createFragment(
  dataDir: string,
  storyId: string,
  fragment: Fragment
): Promise<void> {
  const dir = await fragmentsDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  const normalized = normalizeFragment(fragment)
  await writeJson(await fragmentPath(dataDir, storyId, fragment.id), normalized)
}

export async function getFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  const fragment = await readJson<Fragment>(await fragmentPath(dataDir, storyId, fragmentId))
  return normalizeFragment(fragment)
}

export async function listFragments(
  dataDir: string,
  storyId: string,
  type?: string,
  opts?: { includeArchived?: boolean }
): Promise<Fragment[]> {
  const dir = await fragmentsDir(dataDir, storyId)
  if (!existsSync(dir)) return []

  const includeArchived = opts?.includeArchived ?? false
  const entries = await readdir(dir)
  const fragments: Fragment[] = []

  // Determine prefix filter
  const prefix = type ? (PREFIXES[type] ?? type.slice(0, 2)) : null

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const id = entry.replace('.json', '')
    if (prefix && !id.startsWith(prefix + '-')) continue

    const rawFragment = await readJson<Fragment>(join(dir, entry))
    const fragment = normalizeFragment(rawFragment)
    if (fragment) {
      // Skip archived fragments unless caller opts in
      if (!includeArchived && fragment.archived) continue
      fragments.push(fragment)
    }
  }

  return fragments
}

export async function archiveFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null
  const updated: Fragment = {
    ...fragment,
    archived: true,
    updatedAt: new Date().toISOString(),
  }
  await writeJson(await fragmentPath(dataDir, storyId, fragmentId), updated)
  return updated
}

export async function restoreFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null
  const updated: Fragment = {
    ...fragment,
    archived: false,
    updatedAt: new Date().toISOString(),
  }
  await writeJson(await fragmentPath(dataDir, storyId, fragmentId), updated)
  return updated
}

export async function updateFragment(
  dataDir: string,
  storyId: string,
  fragment: Fragment
): Promise<void> {
  const normalized = normalizeFragment(fragment)
  const path = await fragmentPath(dataDir, storyId, fragment.id)
  requestLogger.info('Updating fragment', { path })
  await writeJson(path, normalized)
}

export async function updateFragmentVersioned(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  updates: Partial<Pick<Fragment, 'name' | 'description' | 'content'>>,
  opts?: { reason?: string }
): Promise<Fragment | null> {
  const existing = await getFragment(dataDir, storyId, fragmentId)
  if (!existing) return null

  const nextName = updates.name ?? existing.name
  const nextDescription = updates.description ?? existing.description
  const nextContent = updates.content ?? existing.content
  const hasVersionedChange =
    nextName !== existing.name ||
    nextDescription !== existing.description ||
    nextContent !== existing.content

  const now = new Date().toISOString()
  const updated: Fragment = hasVersionedChange
    ? {
        ...existing,
        name: nextName,
        description: nextDescription,
        content: nextContent,
        updatedAt: now,
        version: existing.version + 1,
        versions: [...existing.versions, makeVersionSnapshot(existing, opts?.reason)],
      }
    : {
        ...existing,
        name: nextName,
        description: nextDescription,
        content: nextContent,
        updatedAt: now,
      }

  await updateFragment(dataDir, storyId, updated)
  return updated
}

export async function listFragmentVersions(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<FragmentVersion[] | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null
  return [...fragment.versions]
}

export async function revertFragmentToVersion(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  targetVersion?: number
): Promise<Fragment | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null

  const snapshot = targetVersion === undefined
    ? fragment.versions.at(-1)
    : fragment.versions.find((v) => v.version === targetVersion)
  if (!snapshot) return null

  const now = new Date().toISOString()
  const nextVersion = fragment.version + 1
  const updated: Fragment = {
    ...fragment,
    name: snapshot.name,
    description: snapshot.description,
    content: snapshot.content,
    updatedAt: now,
    version: nextVersion,
    versions: [
      ...fragment.versions,
      makeVersionSnapshot(fragment, targetVersion === undefined
        ? `revert-to-${snapshot.version}`
        : `revert-to-${targetVersion}`),
    ],
  }

  await updateFragment(dataDir, storyId, updated)
  return updated
}

export async function deleteFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<void> {
  const path = await fragmentPath(dataDir, storyId, fragmentId)
  if (existsSync(path)) {
    await rm(path)
  }
}
