import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getContentRoot } from '../fragments/branches'

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
  await writeFile(await logPath(dataDir, storyId, log.id), JSON.stringify(log, null, 2), 'utf-8')
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
      stepCount: log.stepCount ?? 1,
      stepsExceeded: log.stepsExceeded ?? false,
    })
  }

  // Sort newest first
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return summaries
}
