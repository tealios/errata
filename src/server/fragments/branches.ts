import { mkdir, readFile, writeFile, cp, rm, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { BranchesIndex, BranchMeta, ProseChain } from './schema'
import { generateBranchId } from '@/lib/fragment-ids'

// --- Branch scope (AsyncLocalStorage) ---

interface BranchScopeContext {
  storyId: string
  branchId: string
}

const branchScope = new AsyncLocalStorage<BranchScopeContext>()

// --- Path helpers ---

function storyDir(dataDir: string, storyId: string): string {
  return join(dataDir, 'stories', storyId)
}

function branchesIndexPath(storyDir: string): string {
  return join(storyDir, 'branches.json')
}

function branchesDir(storyDir: string): string {
  return join(storyDir, 'branches')
}

function branchDir(storyDir: string, branchId: string): string {
  return join(branchesDir(storyDir), branchId)
}

// --- JSON helpers ---

async function readJson<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as T
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

// --- Default branches index ---

function createDefaultBranchesIndex(): BranchesIndex {
  return {
    branches: [{
      id: 'main',
      name: 'Main',
      order: 0,
      createdAt: new Date().toISOString(),
    }],
    activeBranchId: 'main',
  }
}

// --- Migration ---

const CONTENT_ITEMS = [
  'prose-chain.json',
  'fragments',
  'associations.json',
  'generation-logs',
  'librarian',
] as const

// Track migrated stories to avoid repeated checks
const migratedStories = new Set<string>()

export async function migrateIfNeeded(dir: string): Promise<void> {
  if (migratedStories.has(dir)) return

  const bDir = branchesDir(dir)

  // Already migrated
  if (existsSync(bDir)) {
    migratedStories.add(dir)
    return
  }

  // Check if root-level content exists
  const hasRootContent = CONTENT_ITEMS.some(item => existsSync(join(dir, item)))

  const mainDir = branchDir(dir, 'main')
  await mkdir(mainDir, { recursive: true })

  if (hasRootContent) {
    // Move each content item to branches/main/
    for (const item of CONTENT_ITEMS) {
      const src = join(dir, item)
      if (existsSync(src)) {
        const dest = join(mainDir, item)
        await rename(src, dest)
      }
    }
  } else {
    // New story — just ensure fragments dir exists
    await mkdir(join(mainDir, 'fragments'), { recursive: true })
  }

  // Create branches.json
  await writeJson(branchesIndexPath(dir), createDefaultBranchesIndex())
  migratedStories.add(dir)
}

// For tests: clear the migration cache
export function clearMigrationCache(): void {
  migratedStories.clear()
}

// --- Branches Index CRUD ---

export async function getBranchesIndex(dataDir: string, storyId: string): Promise<BranchesIndex> {
  const dir = storyDir(dataDir, storyId)
  await migrateIfNeeded(dir)

  const index = await readJson<BranchesIndex>(branchesIndexPath(dir))
  if (!index) {
    const defaultIndex = createDefaultBranchesIndex()
    await writeJson(branchesIndexPath(dir), defaultIndex)
    return defaultIndex
  }
  return index
}

export async function saveBranchesIndex(dataDir: string, storyId: string, index: BranchesIndex): Promise<void> {
  const dir = storyDir(dataDir, storyId)
  await writeJson(branchesIndexPath(dir), index)
}

// --- Branch scope helpers ---

/**
 * Run `fn` with the branch pinned for this storyId so that all `getContentRoot`
 * calls within the async context resolve to the same branch, even if the user
 * switches timelines while the operation is in-flight.
 *
 * - If a scope already exists for this storyId, the outer scope is inherited
 *   (handles nested calls like librarianChat → runLibrarian).
 * - Otherwise resolves `explicitBranchId ?? getActiveBranchId()` and runs
 *   `fn` inside a new `branchScope.run()`.
 */
export async function withBranch<T>(
  dataDir: string,
  storyId: string,
  fn: () => Promise<T>,
  explicitBranchId?: string,
): Promise<T> {
  const existing = branchScope.getStore()
  if (existing && existing.storyId === storyId) {
    // Inherit the outer scope — don't re-resolve
    return fn()
  }

  const branchId = explicitBranchId ?? await getActiveBranchId(dataDir, storyId)
  return branchScope.run({ storyId, branchId }, fn)
}

// --- Content root resolution ---

export async function getContentRoot(dataDir: string, storyId: string): Promise<string> {
  const dir = storyDir(dataDir, storyId)
  await migrateIfNeeded(dir)

  // If a branch scope is active for this story, use the pinned branch
  const scope = branchScope.getStore()
  if (scope && scope.storyId === storyId) {
    return branchDir(dir, scope.branchId)
  }

  const index = await getBranchesIndex(dataDir, storyId)
  return branchDir(dir, index.activeBranchId)
}

export async function getContentRootForBranch(dataDir: string, storyId: string, branchId: string): Promise<string> {
  const dir = storyDir(dataDir, storyId)
  await migrateIfNeeded(dir)
  return branchDir(dir, branchId)
}

// --- Active branch ---

export async function getActiveBranchId(dataDir: string, storyId: string): Promise<string> {
  const index = await getBranchesIndex(dataDir, storyId)
  return index.activeBranchId
}

export async function switchActiveBranch(dataDir: string, storyId: string, branchId: string): Promise<void> {
  const index = await getBranchesIndex(dataDir, storyId)
  const branch = index.branches.find(b => b.id === branchId)
  if (!branch) {
    throw new Error(`Branch '${branchId}' not found`)
  }
  index.activeBranchId = branchId
  await saveBranchesIndex(dataDir, storyId, index)
}

// --- Branch CRUD ---

export async function createBranch(
  dataDir: string,
  storyId: string,
  name: string,
  parentBranchId: string,
  forkAfterIndex?: number,
): Promise<BranchMeta> {
  const dir = storyDir(dataDir, storyId)
  const index = await getBranchesIndex(dataDir, storyId)

  // Verify parent exists
  const parent = index.branches.find(b => b.id === parentBranchId)
  if (!parent) {
    throw new Error(`Parent branch '${parentBranchId}' not found`)
  }

  const id = generateBranchId()
  const sourceDir = branchDir(dir, parentBranchId)
  const destDir = branchDir(dir, id)

  // Copy parent directory
  await cp(sourceDir, destDir, { recursive: true })

  // Truncate prose chain at fork point if specified
  if (forkAfterIndex !== undefined) {
    const chainPath = join(destDir, 'prose-chain.json')
    if (existsSync(chainPath)) {
      const chain = JSON.parse(await readFile(chainPath, 'utf-8')) as ProseChain
      chain.entries = chain.entries.slice(0, forkAfterIndex + 1)
      await writeJson(chainPath, chain)
    }
  }

  const branch: BranchMeta = {
    id,
    name,
    order: index.branches.length,
    parentBranchId,
    forkAfterIndex,
    createdAt: new Date().toISOString(),
  }

  index.branches.push(branch)
  index.activeBranchId = id
  await saveBranchesIndex(dataDir, storyId, index)

  return branch
}

export async function deleteBranch(dataDir: string, storyId: string, branchId: string): Promise<void> {
  if (branchId === 'main') {
    throw new Error("Cannot delete the 'main' branch")
  }

  const dir = storyDir(dataDir, storyId)
  const index = await getBranchesIndex(dataDir, storyId)

  const branchIdx = index.branches.findIndex(b => b.id === branchId)
  if (branchIdx === -1) {
    throw new Error(`Branch '${branchId}' not found`)
  }

  // Remove directory
  const bDir = branchDir(dir, branchId)
  if (existsSync(bDir)) {
    await rm(bDir, { recursive: true, force: true })
  }

  // Remove from index
  index.branches.splice(branchIdx, 1)

  // Switch to main if deleting active branch
  if (index.activeBranchId === branchId) {
    index.activeBranchId = 'main'
  }

  await saveBranchesIndex(dataDir, storyId, index)
}

export async function renameBranch(dataDir: string, storyId: string, branchId: string, name: string): Promise<BranchMeta> {
  const index = await getBranchesIndex(dataDir, storyId)
  const branch = index.branches.find(b => b.id === branchId)
  if (!branch) {
    throw new Error(`Branch '${branchId}' not found`)
  }
  branch.name = name
  await saveBranchesIndex(dataDir, storyId, index)
  return branch
}

// --- Initialize branches for new story ---

export async function initBranches(dataDir: string, storyId: string): Promise<void> {
  const dir = storyDir(dataDir, storyId)
  const mainDir = branchDir(dir, 'main')
  await mkdir(mainDir, { recursive: true })
  await mkdir(join(mainDir, 'fragments'), { recursive: true })
  await writeJson(branchesIndexPath(dir), createDefaultBranchesIndex())
  migratedStories.add(dir)
}
