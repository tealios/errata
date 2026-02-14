import type { Fragment } from '../fragments/schema'
import { runLibrarian } from './agent'

const pending = new Map<string, ReturnType<typeof setTimeout>>()
const DEBOUNCE_MS = 2000

export function triggerLibrarian(
  dataDir: string,
  storyId: string,
  fragment: Fragment,
): void {
  // Clear any pending run for this story
  const existing = pending.get(storyId)
  if (existing) clearTimeout(existing)

  // Schedule a new run
  pending.set(
    storyId,
    setTimeout(async () => {
      pending.delete(storyId)
      try {
        await runLibrarian(dataDir, storyId, fragment.id)
      } catch (err) {
        console.error(`[librarian] Error for story ${storyId}:`, err)
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
