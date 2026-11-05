import { getFragment } from '../fragments/storage'
import { listAnalyses, selectLatestAnalysesByFragment, type LibrarianAnalysisSummary } from './storage'

/**
 * Why an analysis no longer describes the prose it was run on:
 * - `superseded`: a newer analysis exists for the same fragment
 * - `edited`: the fragment's content changed after the analysis
 * - `missing`: the fragment was deleted
 */
export type AnalysisStaleReason = 'superseded' | 'edited' | 'missing'

export interface AnalysisSummaryWithStaleness extends LibrarianAnalysisSummary {
  stale: boolean
  staleReason?: AnalysisStaleReason
}

export async function listAnalysesWithStaleness(
  dataDir: string,
  storyId: string,
): Promise<AnalysisSummaryWithStaleness[]> {
  const summaries = await listAnalyses(dataDir, storyId)
  const latest = selectLatestAnalysesByFragment(summaries)

  const fragments = new Map<string, Awaited<ReturnType<typeof getFragment>>>()
  for (const fragmentId of latest.keys()) {
    fragments.set(fragmentId, await getFragment(dataDir, storyId, fragmentId).catch(() => null))
  }

  return summaries.map((summary) => {
    const reason = staleReasonFor(summary, latest.get(summary.fragmentId), fragments.get(summary.fragmentId) ?? null)
    return reason ? { ...summary, stale: true, staleReason: reason } : { ...summary, stale: false }
  })
}

function staleReasonFor(
  summary: LibrarianAnalysisSummary,
  latest: LibrarianAnalysisSummary | undefined,
  fragment: Awaited<ReturnType<typeof getFragment>>,
): AnalysisStaleReason | null {
  if (!fragment) return 'missing'
  if (latest && latest.id !== summary.id) return 'superseded'
  if (summary.fragmentVersion !== undefined) {
    return (fragment.version ?? 1) > summary.fragmentVersion ? 'edited' : null
  }
  // Legacy analyses don't record the version they saw: a version snapshot is
  // written at the moment of each content edit, so any snapshot newer than the
  // analysis means the prose changed since.
  const editedSince = (fragment.versions ?? []).some((v) => v.createdAt > summary.createdAt)
  return editedSince ? 'edited' : null
}
