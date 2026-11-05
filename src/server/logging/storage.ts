import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { LogEntry, LogSummary } from './types'

const MAX_LOGS_PER_FILE = 1000
const MAX_LOG_FILES = 5
const NL = String.fromCharCode(10)

function logsDir(dataDir: string): string {
  return join(dataDir, 'logs')
}

function logFilePath(dataDir: string, index: number): string {
  return join(logsDir(dataDir), `app-${index}.jsonl`)
}

interface WriteState {
  /** Index of the file currently being appended to */
  index: number
  /** Lines already in that file */
  count: number
}

/** Per-dataDir write position, initialised lazily from disk */
const writeStates = new Map<string, WriteState>()
/** Single promise queue so log writes never interleave */
let writeQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task)
  writeQueue = run.catch(() => undefined)
  return run
}

async function countLines(path: string): Promise<number> {
  const content = await readFile(path, 'utf-8')
  let n = 0
  for (const line of content.split(NL)) if (line.trim()) n++
  return n
}

async function initWriteState(dataDir: string): Promise<WriteState> {
  let index = 0
  let count = 0
  for (let i = 0; i < MAX_LOG_FILES; i++) {
    const path = logFilePath(dataDir, i)
    if (!existsSync(path)) {
      index = i
      count = 0
      break
    }
    count = await countLines(path)
    index = i
    if (count < MAX_LOGS_PER_FILE) break
  }
  return { index, count }
}

async function rotate(dataDir: string): Promise<void> {
  // Drop the oldest file, shift the rest down by one.
  await rm(logFilePath(dataDir, 0), { force: true })
  for (let i = 1; i < MAX_LOG_FILES; i++) {
    const from = logFilePath(dataDir, i)
    if (existsSync(from)) await rename(from, logFilePath(dataDir, i - 1))
  }
}

/**
 * Save a log entry to the application log file.
 * Writes are serialized and appended; files rotate (oldest dropped) once full.
 */
export function saveLogEntry(dataDir: string, entry: LogEntry): Promise<void> {
  return enqueue(async () => {
    await mkdir(logsDir(dataDir), { recursive: true })

    let state = writeStates.get(dataDir)
    if (!state) {
      state = await initWriteState(dataDir)
      writeStates.set(dataDir, state)
    }

    if (state.count >= MAX_LOGS_PER_FILE) {
      if (state.index + 1 < MAX_LOG_FILES) {
        state.index++
      } else {
        await rotate(dataDir)
      }
      state.count = 0
    }

    await appendFile(logFilePath(dataDir, state.index), JSON.stringify(entry) + NL, 'utf-8')
    state.count++
  })
}

/**
 * List recent log entries with optional filtering.
 */
export async function listLogs(
  dataDir: string,
  options: {
    level?: 'debug' | 'info' | 'warn' | 'error'
    component?: string
    storyId?: string
    limit?: number
  } = {}
): Promise<LogSummary[]> {
  const { level, component, storyId, limit = 100 } = options
  const entries: LogSummary[] = []

  // Read from all log files, newest first
  for (let i = MAX_LOG_FILES - 1; i >= 0; i--) {
    const path = logFilePath(dataDir, i)
    if (!existsSync(path)) continue

    const content = await readFile(path, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim())

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry
        if (level && entry.level !== level) continue
        if (component && entry.component !== component) continue
        if (storyId && entry.storyId !== storyId) continue
        
        entries.push({
          id: entry.id,
          timestamp: entry.timestamp,
          level: entry.level,
          component: entry.component,
          message: entry.message,
          storyId: entry.storyId,
        })
      } catch {
        // Skip invalid lines
      }
    }
  }

  // Sort newest first and limit
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return entries.slice(0, limit)
}

/**
 * Get a specific log entry by ID.
 */
export async function getLogEntry(dataDir: string, logId: string): Promise<LogEntry | null> {
  for (let i = 0; i < MAX_LOG_FILES; i++) {
    const path = logFilePath(dataDir, i)
    if (!existsSync(path)) continue

    const content = await readFile(path, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim())

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry
        if (entry.id === logId) return entry
      } catch {
        // Skip invalid lines
      }
    }
  }
  return null
}

/**
 * Clear all application logs.
 */
export function clearLogs(dataDir: string): Promise<void> {
  return enqueue(async () => {
    writeStates.delete(dataDir)
    const dir = logsDir(dataDir)
    if (!existsSync(dir)) return

    const entries = await readdir(dir)
    for (const entry of entries) {
      if (entry.startsWith('app-') && entry.endsWith('.jsonl')) {
        await writeFile(join(dir, entry), '', 'utf-8')
      }
    }
  })
}
