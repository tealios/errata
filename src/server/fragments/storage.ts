import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Fragment, FragmentVersion, StoryMeta } from './schema'
import { getContentRoot, initBranches } from './branches'
import { createLogger } from '../logging'
import { writeJsonAtomic } from '../fs-utils'
import { withKeyLock } from '../async-lock'
import { assertFragmentId, assertStoryId, isValidFragmentId, isValidStoryId } from '../safe-id'

const requestLogger = createLogger('fragment-storage')

// --- Path helpers ---

function storiesDir(dataDir: string) {
  return join(dataDir, 'stories')
}

function storyDir(dataDir: string, storyId: string) {
  return join(storiesDir(dataDir), assertStoryId(storyId))
}

function storyMetaPath(dataDir: string, storyId: string) {
  return join(storyDir(dataDir, storyId), 'meta.json')
}

async function fragmentsDir(dataDir: string, storyId: string) {
  const root = await getContentRoot(dataDir, storyId)
  return join(root, 'fragments')
}

async function fragmentPath(dataDir: string, storyId: string, fragmentId: string) {
  assertFragmentId(fragmentId)
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
  await writeJsonAtomic(path, data)
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
    version: fragment.version ?? 1,
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
  if (!isValidStoryId(storyId)) return null
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
  if (!isValidStoryId(storyId)) return
  const dir = storyDir(dataDir, storyId)
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true })
  }
}

// --- Fragment CRUD ---

export async function createFragment(
  dataDir: string,
  storyId: string,
  fragment: Fragment,
  opts?: { overwrite?: boolean }
): Promise<void> {
  const dir = await fragmentsDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  const path = await fragmentPath(dataDir, storyId, fragment.id)
  // Guard against silently clobbering an existing fragment. Callers that
  // intentionally replace by id (e.g. pack install) pass overwrite: true.
  if (!opts?.overwrite && existsSync(path)) {
    throw new Error(`Fragment ${fragment.id} already exists; use updateFragment to modify it`)
  }
  const normalized = normalizeFragment(fragment)
  await writeJson(path, normalized)
}

export async function getFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  if (!isValidFragmentId(fragmentId)) return null
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

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue

    const rawFragment = await readJson<Fragment>(join(dir, entry))
    const fragment = normalizeFragment(rawFragment)
    if (fragment) {
      if (type && fragment.type !== type) continue
      // Skip archived fragments unless caller opts in
      if (!includeArchived && fragment.archived) continue
      fragments.push(fragment)
    }
  }

  return fragments
}

/**
 * Serialize read-modify-write cycles on a single fragment. Lock-holding code
 * must use the unlocked `writeFragment` helper, never `updateFragment` /
 * `mutateFragment` (same key would deadlock).
 */
function withFragmentLock<T>(storyId: string, fragmentId: string, fn: () => Promise<T>): Promise<T> {
  return withKeyLock(`fragment:${storyId}:${fragmentId}`, fn)
}

async function writeFragment(dataDir: string, storyId: string, fragment: Fragment): Promise<void> {
  const path = await fragmentPath(dataDir, storyId, fragment.id)
  requestLogger.info('Updating fragment', { path })
  await writeJson(path, normalizeFragment(fragment))
}

/**
 * Atomically read, transform and write one fragment under the per-fragment
 * lock. Returns null when the fragment doesn't exist. If `fn` returns the
 * object it was given, nothing is written.
 */
export async function mutateFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  fn: (fragment: Fragment) => Fragment | Promise<Fragment>,
): Promise<Fragment | null> {
  if (!isValidFragmentId(fragmentId)) return null
  return withFragmentLock(storyId, fragmentId, async () => {
    const existing = await getFragment(dataDir, storyId, fragmentId)
    if (!existing) return null
    const next = await fn(existing)
    if (next !== existing) await writeFragment(dataDir, storyId, next)
    return next
  })
}

export async function archiveFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  return mutateFragment(dataDir, storyId, fragmentId, (fragment) => ({
    ...fragment,
    archived: true,
    updatedAt: new Date().toISOString(),
  }))
}

export async function restoreFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<Fragment | null> {
  return mutateFragment(dataDir, storyId, fragmentId, (fragment) => ({
    ...fragment,
    archived: false,
    updatedAt: new Date().toISOString(),
  }))
}

export async function updateFragment(
  dataDir: string,
  storyId: string,
  fragment: Fragment
): Promise<void> {
  assertFragmentId(fragment.id)
  await withFragmentLock(storyId, fragment.id, () => writeFragment(dataDir, storyId, fragment))
}

type VersionedUpdates = Partial<Pick<Fragment, 'name' | 'description' | 'content'>>

export async function updateFragmentVersioned(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  updatesOrFn: VersionedUpdates | ((existing: Fragment) => VersionedUpdates),
  opts?: {
    reason?: string
    /** Non-versioned fields written in the same locked operation. */
    extra?: Partial<Pick<Fragment, 'sticky' | 'order' | 'placement' | 'meta'>>
  }
): Promise<Fragment | null> {
  if (!isValidFragmentId(fragmentId)) return null
  return withFragmentLock(storyId, fragmentId, async () => {
  const existing = await getFragment(dataDir, storyId, fragmentId)
  if (!existing) return null
  const updates = typeof updatesOrFn === 'function' ? updatesOrFn(existing) : updatesOrFn

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
        version: (existing.version ?? 1) + 1,
        versions: [...(existing.versions ?? []), makeVersionSnapshot(existing, opts?.reason)],
      }
    : {
        ...existing,
        name: nextName,
        description: nextDescription,
        content: nextContent,
        updatedAt: now,
      }

  const withExtra: Fragment = opts?.extra
    ? {
        ...updated,
        ...(opts.extra.sticky !== undefined ? { sticky: opts.extra.sticky } : {}),
        ...(opts.extra.order !== undefined ? { order: opts.extra.order } : {}),
        ...(opts.extra.placement !== undefined ? { placement: opts.extra.placement } : {}),
        ...(opts.extra.meta !== undefined ? { meta: opts.extra.meta } : {}),
      }
    : updated
  await writeFragment(dataDir, storyId, withExtra)
  return withExtra
  })
}

export async function listFragmentVersions(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<FragmentVersion[] | null> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null
  return [...(fragment.versions ?? [])]
}

export async function revertFragmentToVersion(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  targetVersion?: number
): Promise<Fragment | null> {
  if (!isValidFragmentId(fragmentId)) return null
  return withFragmentLock(storyId, fragmentId, async () => {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return null

  const versions = fragment.versions ?? []
  const snapshot = targetVersion === undefined
    ? versions.at(-1)
    : versions.find((v) => v.version === targetVersion)
  if (!snapshot) return null

  const now = new Date().toISOString()
  const nextVersion = (fragment.version ?? 1) + 1
  const updated: Fragment = {
    ...fragment,
    name: snapshot.name,
    description: snapshot.description,
    content: snapshot.content,
    updatedAt: now,
    version: nextVersion,
    versions: [
      ...versions,
      makeVersionSnapshot(fragment, targetVersion === undefined
        ? `revert-to-${snapshot.version}`
        : `revert-to-${targetVersion}`),
    ],
  }

  await writeFragment(dataDir, storyId, updated)
  return updated
  })
}

export async function deleteFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string
): Promise<void> {
  if (!isValidFragmentId(fragmentId)) return
  const path = await fragmentPath(dataDir, storyId, fragmentId)
  if (existsSync(path)) {
    await rm(path)
  }
}

/**
 * @deprecated TRANSITIONAL. Delete alongside `StoryMeta.summary` once all
 * live stories have been migrated.
 *
 * One-shot migration for the summary-fragments feature. Converts any
 * non-empty `story.summary` string into a single summary fragment, then
 * clears the field. Idempotent — running again with no `story.summary`
 * is a no-op. Existing summary fragments are never overwritten.
 *
 * Called at the top of `buildContextState` and `applyDeferredSummaries`
 * so legacy content surfaces through the new fragment path on first use.
 */
export async function migrateStoryToSummaryFragments(
  dataDir: string,
  storyId: string,
): Promise<{ migrated: boolean; fragmentId?: string }> {
  const story = await getStory(dataDir, storyId)
  if (!story) return { migrated: false }

  const legacy = typeof story.summary === 'string' ? story.summary.trim() : ''
  if (!legacy) return { migrated: false }

  const existing = await listFragments(dataDir, storyId, 'summary', { includeArchived: true })
  if (existing.length > 0) {
    // Already migrated or summaries exist from the new flow. Clear the
    // legacy field so it doesn't drift further.
    await updateStory(dataDir, { ...story, summary: '', updatedAt: new Date().toISOString() })
    return { migrated: false }
  }

  const { generateFragmentId } = await import('@/lib/fragment-ids')
  const now = new Date().toISOString()
  const fragment: Fragment = {
    id: generateFragmentId('summary'),
    type: 'summary',
    name: 'Story summary',
    description: 'Rolling summary migrated from the legacy story.summary field.',
    content: legacy,
    tags: [],
    refs: [],
    sticky: false,
    placement: 'system',
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {
      isEraSummary: true,
      chapterId: null,
      migratedFromLegacy: true,
    },
    archived: false,
    version: 1,
    versions: [],
  }

  await createFragment(dataDir, storyId, fragment)
  await updateStory(dataDir, { ...story, summary: '', updatedAt: now })

  requestLogger.info('Migrated legacy story.summary to summary fragment', {
    storyId,
    fragmentId: fragment.id,
    length: legacy.length,
  })

  return { migrated: true, fragmentId: fragment.id }
}
