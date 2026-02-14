import type { Fragment } from '../fragments/schema'
import { runLibrarian } from './agent'
import { createLogger } from '../logging'

const pending = new Map<string, ReturnType<typeof setTimeout>>()
const DEBOUNCE_MS = 2000
const logger = createLogger('librarian')

export function triggerLibrarian(
  dataDir: string,
  storyId: string,
  fragment: Fragment,
): void {
  const requestLogger = logger.child({ storyId })

  // Clear any pending run for this story
  const existing = pending.get(storyId)
  if (existing) {
    requestLogger.debug('Cancelling pending librarian run')
    clearTimeout(existing)
  }

  // Schedule a new run
  requestLogger.info('Scheduling librarian run', { fragmentId: fragment.id, debounceMs: DEBOUNCE_MS })
  pending.set(
    storyId,
    setTimeout(async () => {
      pending.delete(storyId)
      try {
        requestLogger.info('Starting librarian analysis...', { fragmentId: fragment.id })
        const startTime = Date.now()
        await runLibrarian(dataDir, storyId, fragment.id)
        const durationMs = Date.now() - startTime
        requestLogger.info('Librarian analysis completed', { fragmentId: fragment.id, durationMs })
      } catch (err) {
        requestLogger.error('Librarian analysis failed', {
          fragmentId: fragment.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }, DEBOUNCE_MS),
  )
}

/** Clear all pending timers (useful for tests) */
export function clearPending(): void {
  for (const timer of pending.values()) {
    clearTimeout(timer)
  }
  pending.clear()
}

/** Get the number of pending runs (useful for tests) */
export function getPendingCount(): number {
  return pending.size
}
