import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getContentRoot } from '../fragments/branches'
import { writeJsonAtomic } from '../fs-utils'
import { getActiveProseIds } from '../fragments/prose-chain'

/** Max generation logs kept per story; older ones are pruned on save. */
export const MAX_GENERATION_LOGS = 200
import { createLogger } from '../logging'

const logger = createLogger('generation-logs')

export interface ToolCallLog {
  toolName: string
  args: Record<string, unknown>
  result: unknown
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface GenerationLog {
  id: string
  createdAt: string
  input: string
  messages: Array<{ role: string; content: string }>
  toolCalls: ToolCallLog[]
  generatedText: string
  fragmentId: string | null
  model: string
  durationMs: number
  stepCount: number
  finishReason: string
  stepsExceeded: boolean
  totalUsage?: TokenUsage
  reasoning?: string
  prewriterBrief?: string
  prewriterReasoning?: string
  prewriterMessages?: Array<{ role: string; content: string }>
  prewriterDurationMs?: number
  prewriterModel?: string
  prewriterUsage?: TokenUsage
  prewriterDirections?: Array<{ pacing: string; title: string; description: string; instruction: string }>
}

export interface GenerationLogSummary {
  id: string
  createdAt: string
  input: string
  fragmentId: string | null
  model: string
  durationMs: number
  toolCallCount: number
  stepCount: number
  stepsExceeded: boolean
}

async function logsDir(dataDir: string, storyId: string): Promise<string> {
  const root = await getContentRoot(dataDir, storyId)
  return join(root, 'generation-logs')
}

async function logPath(dataDir: string, storyId: string, logId: string): Promise<string> {
  const dir = await logsDir(dataDir, storyId)
  return join(dir, `${logId}.json`)
}

export async function saveGenerationLog(
  dataDir: string,
  storyId: string,
  log: GenerationLog,
): Promise<void> {
  const dir = await logsDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  await writeJsonAtomic(await logPath(dataDir, storyId, log.id), log)
  try {
    await pruneGenerationLogs(dataDir, storyId)
  } catch (err) {
    logger.warn('Failed to prune generation logs', { storyId, error: String(err) })
  }
}

/**
 * Delete the oldest logs (by file modification time) beyond `keep`. Logs whose
 * fragment is still active in the prose chain are never deleted, so the count
 * can exceed `keep` slightly. Returns the number of logs removed.
 */
export async function pruneGenerationLogs(
  dataDir: string,
  storyId: string,
  keep: number = MAX_GENERATION_LOGS,
): Promise<number> {
  const dir = await logsDir(dataDir, storyId)
  if (!existsSync(dir)) return 0
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
  if (names.length <= keep) return 0

  const stamped = await Promise.all(names.map(async (name) => {
    try {
      return { name, t: (await stat(join(dir, name))).mtimeMs }
    } catch {
      return null
    }
  }))
  const sorted = stamped.filter((e): e is { name: string; t: number } => e !== null)
    .sort((a, b) => b.t - a.t || b.name.localeCompare(a.name))
  const candidates = sorted.slice(keep)
  if (candidates.length === 0) return 0

  const active = new Set(await getActiveProseIds(dataDir, storyId).catch(() => [] as string[]))
  let removed = 0
  for (const { name } of candidates) {
    try {
      if (active.size > 0) {
        const parsed = JSON.parse(await readFile(join(dir, name), 'utf-8')) as GenerationLog
        if (parsed.fragmentId && active.has(parsed.fragmentId)) continue
      }
      await rm(join(dir, name), { force: true })
      removed++
    } catch (err) {
      logger.warn('Failed to prune generation log', { storyId, name, error: String(err) })
    }
  }
  return removed
}

export async function getGenerationLog(
  dataDir: string,
  storyId: string,
  logId: string,
): Promise<GenerationLog | null> {
  const path = await logPath(dataDir, storyId, logId)
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as GenerationLog
}

export async function listGenerationLogs(
  dataDir: string,
  storyId: string,
): Promise<GenerationLogSummary[]> {
  const dir = await logsDir(dataDir, storyId)
  if (!existsSync(dir)) return []

  const entries = await readdir(dir)
  const summaries: GenerationLogSummary[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    let log: GenerationLog
    try {
      log = JSON.parse(await readFile(join(dir, entry), 'utf-8')) as GenerationLog
    } catch (err) {
      logger.warn('Skipping unreadable generation log', { storyId, file: entry, error: err instanceof Error ? err.message : String(err) })
      continue
    }
    summaries.push({
      id: log.id,
      createdAt: log.createdAt,
      input: log.input,
      fragmentId: log.fragmentId,
      model: log.model,
      durationMs: log.durationMs,
      toolCallCount: log.toolCalls.length,
      stepCount: log.stepCount ?? 1,
      stepsExceeded: log.stepsExceeded ?? false,
    })
  }

  // Sort newest first
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return summaries
}

/**
 * Find the most recent generation log produced for a given fragment. Logs link
 * back to their fragment via `fragmentId` (there is no forward pointer on the
 * fragment), so this is a reverse scan. Returns null if the fragment was never
 * generated (e.g. written or imported manually) or its log was pruned.
 */
export async function findGenerationLogByFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<GenerationLog | null> {
  const dir = await logsDir(dataDir, storyId)
  if (!existsSync(dir)) return null

  const entries = await readdir(dir)
  let best: GenerationLog | null = null
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    let log: GenerationLog
    try {
      log = JSON.parse(await readFile(join(dir, entry), 'utf-8')) as GenerationLog
    } catch (err) {
      logger.warn('Skipping unreadable generation log', { storyId, file: entry, error: err instanceof Error ? err.message : String(err) })
      continue
    }
    if (log.fragmentId !== fragmentId) continue
    if (!best || log.createdAt.localeCompare(best.createdAt) > 0) best = log
  }
  return best
}
