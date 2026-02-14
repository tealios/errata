/**
 * Log entry types for the application logging system.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  component: string
  message: string
  context?: Record<string, unknown>
  storyId?: string
  durationMs?: number
}

export interface LogSummary {
  id: string
  timestamp: string
  level: LogLevel
  component: string
  message: string
  storyId?: string
}

export interface GenerationPipelineLog {
  id: string
  timestamp: string
  storyId: string
  level: 'info' | 'warn' | 'error'
  phase: 'context' | 'generation' | 'tool' | 'save' | 'hook' | 'librarian'
  message: string
  durationMs?: number
  context?: Record<string, unknown>
}

export interface ToolExecutionLog {
  toolName: string
  storyId: string
  fragmentId?: string
  durationMs: number
  success: boolean
  error?: string
}
