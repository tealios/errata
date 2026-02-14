import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export interface ToolCallLog {
  toolName: string
  args: Record<string, unknown>
  result: unknown
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
}

export interface GenerationLogSummary {
  id: string
  createdAt: string
  input: string
  fragmentId: string | null
  model: string
  durationMs: number
  toolCallCount: number
}

function logsDir(dataDir: string, storyId: string): string {
  return join(dataDir, 'stories', storyId, 'generation-logs')
}

function logPath(dataDir: string, storyId: string, logId: string): string {
  return join(logsDir(dataDir, storyId), `${logId}.json`)
}

export async function saveGenerationLog(
  dataDir: string,
  storyId: string,
  log: GenerationLog,
): Promise<void> {
  const dir = logsDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  await writeFile(logPath(dataDir, storyId, log.id), JSON.stringify(log, null, 2), 'utf-8')
}

export async function getGenerationLog(
  dataDir: string,
  storyId: string,
  logId: string,
): Promise<GenerationLog | null> {
  const path = logPath(dataDir, storyId, logId)
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as GenerationLog
}

export async function listGenerationLogs(
  dataDir: string,
  storyId: string,
): Promise<GenerationLogSummary[]> {
  const dir = logsDir(dataDir, storyId)
  if (!existsSync(dir)) return []

  const entries = await readdir(dir)
  const summaries: GenerationLogSummary[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const raw = await readFile(join(dir, entry), 'utf-8')
    const log = JSON.parse(raw) as GenerationLog
    summaries.push({
      id: log.id,
      createdAt: log.createdAt,
      input: log.input,
      fragmentId: log.fragmentId,
      model: log.model,
      durationMs: log.durationMs,
      toolCallCount: log.toolCalls.length,
    })
  }

  // Sort newest first
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return summaries
}
