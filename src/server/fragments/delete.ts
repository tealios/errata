import { deleteFragment, listFragments, mutateFragment } from './storage'
import { removeFragmentFromAssociations } from './associations'
import { assignFragment } from './folders'
import { removeFragmentFromProseChain } from './prose-chain'
import { createLogger } from '../logging'

const logger = createLogger('fragment-delete')

function pointsAt(v: unknown, fragmentId: string): boolean {
  return !!v && typeof v === 'object' && (v as { fragmentId?: unknown }).fragmentId === fragmentId
}

/**
 * Permanently delete a fragment and clean up everything that pointed at it:
 * tag/ref indexes, other fragments' `refs` and `meta.visualRefs`, folder
 * assignment, and prose-chain entries. Archiving must NOT use this.
 */
export async function deleteFragmentCascade(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<void> {
  await deleteFragment(dataDir, storyId, fragmentId)

  const steps: Array<[string, () => Promise<unknown>]> = [
    ['associations', () => removeFragmentFromAssociations(dataDir, storyId, fragmentId)],
    ['folder', () => assignFragment(dataDir, storyId, fragmentId, null)],
    ['prose-chain', () => removeFragmentFromProseChain(dataDir, storyId, fragmentId)],
    ['references', async () => {
      const all = await listFragments(dataDir, storyId, undefined, { includeArchived: true })
      for (const other of all) {
        if (other.id === fragmentId) continue
        const visual = other.meta?.visualRefs
        const hasVisual = Array.isArray(visual) && visual.some((v) => pointsAt(v, fragmentId))
        if (!other.refs.includes(fragmentId) && !hasVisual) continue
        await mutateFragment(dataDir, storyId, other.id, (f) => {
          const vr = f.meta?.visualRefs
          const meta = Array.isArray(vr)
            ? { ...f.meta, visualRefs: vr.filter((v) => !pointsAt(v, fragmentId)) }
            : f.meta
          return {
            ...f,
            refs: f.refs.filter((id) => id !== fragmentId),
            meta,
            updatedAt: new Date().toISOString(),
          }
        })
      }
    }],
  ]

  for (const [name, run] of steps) {
    try {
      await run()
    } catch (err) {
      logger.warn(`Cascade cleanup failed: ${name}`, { storyId, fragmentId, error: String(err) })
    }
  }
}
