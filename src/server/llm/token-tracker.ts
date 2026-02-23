/**
 * Centralized token usage tracker.
 *
 * Tracks input/output tokens per source (agent/call site) and per model,
 * both in-memory (session — resets on server restart) and persistently
 * per-story on disk.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createLogger } from '../logging'

const logger = createLogger('token-tracker')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageEntry {
  inputTokens: number
  outputTokens: number
  calls: number
}

export interface SourceUsage extends UsageEntry {
  /** Breakdown by model ID */
  byModel: Record<string, UsageEntry>
}

export interface ProjectUsage {
  sources: Record<string, SourceUsage>
  total: UsageEntry
  byModel: Record<string, UsageEntry>
  updatedAt: string
}

// ---------------------------------------------------------------------------
// In-memory session state (resets on server restart)
// ---------------------------------------------------------------------------

/** Per-story, per-source session counters */
const sessionByStory = new Map<string, Map<string, SourceUsage>>()

/** Cross-story session total */
const globalSession: UsageEntry = { inputTokens: 0, outputTokens: 0, calls: 0 }

/** Cross-story session total by model */
const globalSessionByModel = new Map<string, UsageEntry>()

// ---------------------------------------------------------------------------
// Debounced persistence
// ---------------------------------------------------------------------------

const pendingWrites = new Map<string, NodeJS.Timeout>()
const FLUSH_DELAY_MS = 2000

function usagePath(dataDir: string, storyId: string): string {
  return join(dataDir, 'stories', storyId, 'token-usage.json')
}

function emptyProjectUsage(): ProjectUsage {
  return { sources: {}, total: { inputTokens: 0, outputTokens: 0, calls: 0 }, byModel: {}, updatedAt: new Date().toISOString() }
}

async function readProjectFile(dataDir: string, storyId: string): Promise<ProjectUsage> {
  const path = usagePath(dataDir, storyId)
  if (!existsSync(path)) return emptyProjectUsage()
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as ProjectUsage
    // Migrate older format that lacked byModel at top level or per-source
    if (!parsed.byModel) parsed.byModel = {}
    for (const key of Object.keys(parsed.sources)) {
      if (!parsed.sources[key].byModel) parsed.sources[key].byModel = {}
    }
    return parsed
  } catch {
    return emptyProjectUsage()
  }
}

async function writeProjectFile(dataDir: string, storyId: string, data: ProjectUsage): Promise<void> {
  const dir = join(dataDir, 'stories', storyId)
  await mkdir(dir, { recursive: true })
  await writeFile(usagePath(dataDir, storyId), JSON.stringify(data, null, 2), 'utf-8')
}

interface FlushDelta {
  source: string
  modelId: string
  inputTokens: number
  outputTokens: number
}

/** Buffered deltas waiting for flush */
const pendingFlushData = new Map<string, FlushDelta[]>()

function incrementEntry(entry: UsageEntry, inputTokens: number, outputTokens: number): void {
  entry.inputTokens += inputTokens
  entry.outputTokens += outputTokens
  entry.calls += 1
}

function scheduleFlush(dataDir: string, storyId: string, delta: FlushDelta): void {
  const key = `${dataDir}::${storyId}`

  const existing = pendingFlushData.get(key) ?? []
  existing.push(delta)
  pendingFlushData.set(key, existing)

  if (pendingWrites.has(key)) return // already scheduled

  const timer = setTimeout(async () => {
    pendingWrites.delete(key)
    const deltas = pendingFlushData.get(key) ?? []
    pendingFlushData.delete(key)
    if (deltas.length === 0) return

    try {
      const project = await readProjectFile(dataDir, storyId)
      for (const d of deltas) {
        // Per-source totals
        const sourceEntry = project.sources[d.source] ?? { inputTokens: 0, outputTokens: 0, calls: 0, byModel: {} }
        incrementEntry(sourceEntry, d.inputTokens, d.outputTokens)

        // Per-source per-model
        const sourceModelEntry = sourceEntry.byModel[d.modelId] ?? { inputTokens: 0, outputTokens: 0, calls: 0 }
        incrementEntry(sourceModelEntry, d.inputTokens, d.outputTokens)
        sourceEntry.byModel[d.modelId] = sourceModelEntry

        project.sources[d.source] = sourceEntry

        // Global totals
        incrementEntry(project.total, d.inputTokens, d.outputTokens)

        // Global per-model
        const globalModelEntry = project.byModel[d.modelId] ?? { inputTokens: 0, outputTokens: 0, calls: 0 }
        incrementEntry(globalModelEntry, d.inputTokens, d.outputTokens)
        project.byModel[d.modelId] = globalModelEntry
      }
      project.updatedAt = new Date().toISOString()
      await writeProjectFile(dataDir, storyId, project)
    } catch (err) {
      logger.error('Failed to flush token usage', { storyId, error: err instanceof Error ? err.message : String(err) })
    }
  }, FLUSH_DELAY_MS)

  pendingWrites.set(key, timer)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Report token usage from an LLM call.
 *
 * Updates in-memory session counters immediately and schedules a debounced
 * write to the persistent per-story JSON file.
 */
export function reportUsage(
  dataDir: string,
  storyId: string,
  source: string,
  usage: { inputTokens: number; outputTokens: number },
  modelId?: string,
): void {
  if (!usage.inputTokens && !usage.outputTokens) return

  const model = modelId ?? 'unknown'

  // Session: per-story per-source
  let storyMap = sessionByStory.get(storyId)
  if (!storyMap) {
    storyMap = new Map()
    sessionByStory.set(storyId, storyMap)
  }
  const entry = storyMap.get(source) ?? { inputTokens: 0, outputTokens: 0, calls: 0, byModel: {} }
  incrementEntry(entry, usage.inputTokens, usage.outputTokens)

  const sourceModelEntry = entry.byModel[model] ?? { inputTokens: 0, outputTokens: 0, calls: 0 }
  incrementEntry(sourceModelEntry, usage.inputTokens, usage.outputTokens)
  entry.byModel[model] = sourceModelEntry

  storyMap.set(source, entry)

  // Session: global totals
  incrementEntry(globalSession, usage.inputTokens, usage.outputTokens)

  // Session: global by model
  const gModelEntry = globalSessionByModel.get(model) ?? { inputTokens: 0, outputTokens: 0, calls: 0 }
  incrementEntry(gModelEntry, usage.inputTokens, usage.outputTokens)
  globalSessionByModel.set(model, gModelEntry)

  // Persistent: debounced
  scheduleFlush(dataDir, storyId, { source, modelId: model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
}

export interface UsageSnapshot {
  sources: Record<string, SourceUsage>
  total: UsageEntry
  byModel: Record<string, UsageEntry>
}

/**
 * Get session usage (in-memory, since last server restart).
 * If storyId is provided, returns per-story data; otherwise global.
 */
export function getSessionUsage(storyId?: string): UsageSnapshot {
  if (!storyId) {
    const byModel: Record<string, UsageEntry> = {}
    for (const [model, entry] of globalSessionByModel) {
      byModel[model] = { ...entry }
    }
    return { sources: {}, total: { ...globalSession }, byModel }
  }

  const storyMap = sessionByStory.get(storyId)
  if (!storyMap) {
    return { sources: {}, total: { inputTokens: 0, outputTokens: 0, calls: 0 }, byModel: {} }
  }

  const sources: Record<string, SourceUsage> = {}
  const total: UsageEntry = { inputTokens: 0, outputTokens: 0, calls: 0 }
  const byModel: Record<string, UsageEntry> = {}

  for (const [source, entry] of storyMap) {
    const clonedByModel: Record<string, UsageEntry> = {}
    for (const [model, mEntry] of Object.entries(entry.byModel)) {
      clonedByModel[model] = { ...mEntry }

      // Aggregate to top-level byModel
      const existing = byModel[model] ?? { inputTokens: 0, outputTokens: 0, calls: 0 }
      existing.inputTokens += mEntry.inputTokens
      existing.outputTokens += mEntry.outputTokens
      existing.calls += mEntry.calls
      byModel[model] = existing
    }
    sources[source] = { inputTokens: entry.inputTokens, outputTokens: entry.outputTokens, calls: entry.calls, byModel: clonedByModel }
    total.inputTokens += entry.inputTokens
    total.outputTokens += entry.outputTokens
    total.calls += entry.calls
  }

  return { sources, total, byModel }
}

/**
 * Get persistent project-level usage for a story (from disk).
 */
export async function getProjectUsage(dataDir: string, storyId: string): Promise<ProjectUsage> {
  return readProjectFile(dataDir, storyId)
}
