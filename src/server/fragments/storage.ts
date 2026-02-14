import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Fragment, StoryMeta } from './schema'
import { PREFIXES } from '@/lib/fragment-ids'

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

function fragmentsDir(dataDir: string, storyId: string) {
  return join(storyDir(dataDir, storyId), 'fragments')
}

function fragmentPath(dataDir: string, storyId: string, fragmentId: string) {
  return join(fragmentsDir(dataDir, storyId), `${fragmentId}.json`)
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

// --- Story CRUD ---

export async function createStory(
  dataDir: string,
  story: StoryMeta
): Promise<void> {
  const dir = storyDir(dataDir, story.id)
  await mkdir(dir, { recursive: true })
  await mkdir(fragmentsDir(dataDir, story.id), { recursive: true })
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
  const dir = fragmentsDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  await writeJson(fragmentPath(dataDir, storyId, fragment.id), fragment)
}

export async function getFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  return readJson<Fragment>(fragmentPath(dataDir, storyId, fragmentId))
}

export async function listFragments(
  dataDir: string,
  storyId: string,
  type?: string,
  opts?: { includeArchived?: boolean }
): Promise<Fragment[]> {
  const dir = fragmentsDir(dataDir, storyId)
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

    const fragment = await readJson<Fragment>(join(dir, entry))
    if (fragment) {
      // Default archived to false for legacy files
      if (fragment.archived === undefined) fragment.archived = false
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
  await writeJson(fragmentPath(dataDir, storyId, fragmentId), updated)
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
  await writeJson(fragmentPath(dataDir, storyId, fragmentId), updated)
  return updated
}

export async function updateFragment(
  dataDir: string,
  storyId: string,
  fragment: Fragment
): Promise<void> {
  await writeJson(fragmentPath(dataDir, storyId, fragment.id), fragment)
}

export async function deleteFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<void> {
  const path = fragmentPath(dataDir, storyId, fragmentId)
  if (existsSync(path)) {
    await rm(path)
  }
}
