import type { Fragment } from '../fragments/schema'
import { invokeAgent } from '../agents'
import { createLogger } from '../logging'
import { getActiveBranchId, withBranch } from '../fragments/branches'

const runtimeStatus = new Map<string, LibrarianRuntimeStatus>()
const DEBOUNCE_MS = 2000
const logger = createLogger('librarian')

export type LibrarianRunStatus = 'idle' | 'scheduled' | 'running' | 'error'

export interface LibrarianRuntimeStatus {
  runStatus: LibrarianRunStatus
  pendingFragmentId: string | null
  runningFragmentId: string | null
  lastError: string | null
  updatedAt: string
}

function makeDefaultStatus(): LibrarianRuntimeStatus {
  return {
    runStatus: 'idle',
    pendingFragmentId: null,
    runningFragmentId: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  }
}

function setRuntimeStatus(storyId: string, patch: Partial<LibrarianRuntimeStatus>): void {
  const base = runtimeStatus.get(storyId) ?? makeDefaultStatus()
  runtimeStatus.set(storyId, {
    ...base,
    ...patch,
    updatedAt: new Date().toISOString(),
  })
}

interface PendingBatch {
  timer: ReturnType<typeof setTimeout>
  /** Insertion-ordered queue keyed by `${branchId}:${fragmentId}` */
  items: Map<string, { fragmentId: string; branchId: string }>
}

const batches = new Map<string, PendingBatch>()
/** Number of batches currently executing per story */
const activeRuns = new Map<string, number>()

async function runBatch(
  dataDir: string,
  storyId: string,
  items: Array<{ fragmentId: string; branchId: string }>,
): Promise<void> {
  const requestLogger = logger.child({ storyId })
  activeRuns.set(storyId, (activeRuns.get(storyId) ?? 0) + 1)
  let lastError: string | null = null
  try {
    for (const { fragmentId, branchId } of items) {
      setRuntimeStatus(storyId, {
        runStatus: 'running',
        runningFragmentId: fragmentId,
      })
      try {
        requestLogger.info('Starting librarian analysis...', { fragmentId, branchId })
        const startTime = Date.now()
        await withBranch(dataDir, storyId, () => invokeAgent({
          dataDir,
          storyId,
          agentName: 'librarian.analyze',
          input: { fragmentId },
        }), branchId)
        requestLogger.info('Librarian analysis completed', { fragmentId, durationMs: Date.now() - startTime })
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        requestLogger.error('Librarian analysis failed', { fragmentId, error: lastError })
      }
    }
  } finally {
    const remaining = (activeRuns.get(storyId) ?? 1) - 1
    if (remaining <= 0) activeRuns.delete(storyId)
    else activeRuns.set(storyId, remaining)

    const rescheduled = batches.has(storyId)
    if (rescheduled) {
      // A newer run was scheduled while we ran: leave its 'scheduled' state alone
      setRuntimeStatus(storyId, { runningFragmentId: null, ...(lastError ? { lastError } : {}) })
    } else if (remaining > 0) {
      setRuntimeStatus(storyId, { ...(lastError ? { lastError } : {}) })
    } else {
      setRuntimeStatus(storyId, {
        runStatus: lastError ? 'error' : 'idle',
        pendingFragmentId: null,
        runningFragmentId: null,
        lastError,
      })
    }
  }
}

export async function triggerLibrarian(
  dataDir: string,
  storyId: string,
  fragment: Fragment,
): Promise<void> {
  const requestLogger = logger.child({ storyId })

  // Capture the active branch NOW, before the debounce delay
  const branchId = await getActiveBranchId(dataDir, storyId)

  // Reset the debounce timer but keep every queued fragment
  const existing = batches.get(storyId)
  const items = existing?.items ?? new Map<string, { fragmentId: string; branchId: string }>()
  if (existing) {
    requestLogger.debug('Resetting librarian debounce')
    clearTimeout(existing.timer)
  }
  const key = `${branchId}:${fragment.id}`
  items.delete(key)
  items.set(key, { fragmentId: fragment.id, branchId })

  requestLogger.info('Scheduling librarian run', { fragmentId: fragment.id, branchId, debounceMs: DEBOUNCE_MS, queued: items.size })
  setRuntimeStatus(storyId, {
    runStatus: 'scheduled',
    pendingFragmentId: fragment.id,
    lastError: null,
  })
  const timer = setTimeout(() => {
    batches.delete(storyId)
    setRuntimeStatus(storyId, { pendingFragmentId: null })
    void runBatch(dataDir, storyId, [...items.values()])
  }, DEBOUNCE_MS)
  batches.set(storyId, { timer, items })
}

/** Clear all pending timers (useful for tests) */
export function clearPending(): void {
  for (const [storyId, batch] of batches.entries()) {
    clearTimeout(batch.timer)
    setRuntimeStatus(storyId, {
      runStatus: 'idle',
      pendingFragmentId: null,
      runningFragmentId: null,
    })
  }
  batches.clear()
}

/** Get the number of pending runs (useful for tests) */
export function getPendingCount(): number {
  return batches.size
}

export function getLibrarianRuntimeStatus(storyId: string): LibrarianRuntimeStatus {
  return runtimeStatus.get(storyId) ?? makeDefaultStatus()
}
