import type { AgentTraceEntry } from './types'

export interface AgentRunTraceRecord {
  rootRunId: string
  runId: string
  storyId: string
  agentName: string
  status: 'success' | 'error'
  startedAt: string
  finishedAt: string
  durationMs: number
  error?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  trace: AgentTraceEntry[]
}

const MAX_RUNS_PER_STORY = 100
const tracesByStory = new Map<string, AgentRunTraceRecord[]>()

export function recordAgentRun(storyId: string, record: AgentRunTraceRecord): void {
  const existing = tracesByStory.get(storyId) ?? []
  const next = [record, ...existing]
  if (next.length > MAX_RUNS_PER_STORY) {
    next.length = MAX_RUNS_PER_STORY
  }
  tracesByStory.set(storyId, next)
}

export function listAgentRuns(storyId: string, limit = 30): AgentRunTraceRecord[] {
  const records = tracesByStory.get(storyId) ?? []
  return records.slice(0, Math.max(0, limit))
}

export function clearAgentRuns(storyId?: string): void {
  if (storyId) {
    tracesByStory.delete(storyId)
    return
  }
  tracesByStory.clear()
}
