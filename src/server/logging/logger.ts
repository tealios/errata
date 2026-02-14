import type { LogEntry, LogLevel } from './types'
import { saveLogEntry } from './storage'

const DATA_DIR = process.env.DATA_DIR ?? './data'
const IS_TEST = process.env.NODE_ENV === 'test' || process.env.VITEST

/**
 * Logger service for the application.
 * Provides structured logging with component tracking and context.
 */
export class Logger {
  private component: string
  private storyId?: string
  private dataDir: string

  constructor(component: string, options: { storyId?: string; dataDir?: string } = {}) {
    this.component = component
    this.storyId = options.storyId
    this.dataDir = options.dataDir ?? DATA_DIR
  }

  /**
   * Create a child logger with additional context.
   */
  child(additionalContext: { storyId?: string }): Logger {
    return new Logger(this.component, {
      storyId: additionalContext.storyId ?? this.storyId,
      dataDir: this.dataDir,
    })
  }

  private async log(level: LogLevel, message: string, context?: Record<string, unknown>): Promise<void> {
    const entry: LogEntry = {
      id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      context,
      storyId: this.storyId,
    }

    // Output to console for development/debugging
    const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    const prefix = this.storyId ? `[${this.component}:${this.storyId}]` : `[${this.component}]`
    consoleMethod(`${prefix} ${message}`, context ?? '')

    // Persist to storage (skip in test mode to avoid file cleanup issues)
    if (IS_TEST) return

    try {
      await saveLogEntry(this.dataDir, entry)
    } catch (err) {
      // If logging fails, at least we have console output
      console.error('[logger] Failed to save log entry:', err)
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context)
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context)
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context)
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context)
  }

  /**
   * Log with timing information.
   */
  async timed<T>(
    message: string,
    operation: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    const start = Date.now()
    try {
      const result = await operation()
      const durationMs = Date.now() - start
      this.info(`${message} (completed)`, { ...context, durationMs, success: true })
      return result
    } catch (err) {
      const durationMs = Date.now() - start
      this.error(`${message} (failed)`, { 
        ...context, 
        durationMs, 
        success: false, 
        error: err instanceof Error ? err.message : String(err) 
      })
      throw err
    }
  }
}

/**
 * Create a logger for a specific component.
 */
export function createLogger(component: string, options?: { storyId?: string; dataDir?: string }): Logger {
  return new Logger(component, options)
}

/**
 * Default logger instance for general use.
 */
export const logger = createLogger('app')
