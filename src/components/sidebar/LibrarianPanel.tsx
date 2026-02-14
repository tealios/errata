import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  api,
  type LibrarianAnalysis,
  type LibrarianAnalysisSummary,
  type LibrarianState,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  AlertTriangle,
  Lightbulb,
  Clock,
  Users,
  ChevronDown,
  ChevronRight,
  Plus,
} from 'lucide-react'

interface LibrarianPanelProps {
  storyId: string
  onCreateFragment?: (type: string, prefill?: { name: string; description: string; content: string }) => void
}

export function LibrarianPanel({ storyId, onCreateFragment }: LibrarianPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: status } = useQuery({
    queryKey: ['librarian-status', storyId],
    queryFn: () => api.librarian.getStatus(storyId),
    refetchInterval: 5000,
  })

  const { data: analyses } = useQuery({
    queryKey: ['librarian-analyses', storyId],
    queryFn: () => api.librarian.listAnalyses(storyId),
    refetchInterval: 5000,
  })

  const { data: expandedAnalysis } = useQuery({
    queryKey: ['librarian-analysis', storyId, expandedId],
    queryFn: () => api.librarian.getAnalysis(storyId, expandedId!),
    enabled: !!expandedId,
  })

  const totalContradictions = analyses?.reduce((n, a) => n + a.contradictionCount, 0) ?? 0
  const totalSuggestions = analyses?.reduce((n, a) => n + a.suggestionCount, 0) ?? 0

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Status */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Status</h4>
          <div className="flex items-center gap-2 text-sm">
            <div className="size-2 rounded-full bg-green-500" />
            <span>Idle</span>
          </div>
          {status?.lastAnalyzedFragmentId && (
            <p className="text-xs text-muted-foreground mt-1">
              Last analyzed: {status.lastAnalyzedFragmentId}
            </p>
          )}
        </div>

        <Separator />

        {/* Summary badges */}
        <div className="flex gap-2 flex-wrap">
          {totalContradictions > 0 && (
            <Badge variant="destructive" className="text-xs">
              <AlertTriangle className="size-3 mr-1" />
              {totalContradictions} contradiction{totalContradictions !== 1 ? 's' : ''}
            </Badge>
          )}
          {totalSuggestions > 0 && (
            <Badge variant="secondary" className="text-xs">
              <Lightbulb className="size-3 mr-1" />
              {totalSuggestions} suggestion{totalSuggestions !== 1 ? 's' : ''}
            </Badge>
          )}
          {analyses?.length === 0 && (
            <p className="text-xs text-muted-foreground">No analyses yet. Generate some prose to get started.</p>
          )}
        </div>

        {/* Character mentions */}
        {status && Object.keys(status.recentMentions).length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
                <Users className="size-3 inline mr-1" />
                Character Mentions
              </h4>
              <div className="space-y-1">
                {Object.entries(status.recentMentions).map(([charId, fragmentIds]) => (
                  <div key={charId} className="flex items-center justify-between text-xs">
                    <span className="font-mono">{charId}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {fragmentIds.length} mention{fragmentIds.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Timeline */}
        {status && status.timeline.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
                <Clock className="size-3 inline mr-1" />
                Timeline
              </h4>
              <div className="space-y-1">
                {status.timeline.slice(-10).map((entry, i) => (
                  <div key={i} className="text-xs flex gap-2">
                    <span className="font-mono text-muted-foreground shrink-0">{entry.fragmentId}</span>
                    <span>{entry.event}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Analyses list */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
            Recent Analyses
          </h4>
          <div className="space-y-2">
            {analyses?.map((summary) => (
              <AnalysisItem
                key={summary.id}
                summary={summary}
                expanded={expandedId === summary.id}
                analysis={expandedId === summary.id ? expandedAnalysis ?? null : null}
                onToggle={() => setExpandedId(expandedId === summary.id ? null : summary.id)}
                onCreateFragment={onCreateFragment}
              />
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

function AnalysisItem({
  summary,
  expanded,
  analysis,
  onToggle,
  onCreateFragment,
}: {
  summary: LibrarianAnalysisSummary
  expanded: boolean
  analysis: LibrarianAnalysis | null
  onToggle: () => void
  onCreateFragment?: (type: string, prefill?: { name: string; description: string; content: string }) => void
}) {
  const date = new Date(summary.createdAt)
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="border rounded-md">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-2 text-xs hover:bg-muted/50 transition-colors"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="font-mono">{summary.fragmentId}</span>
        <span className="text-muted-foreground">{timeStr}</span>
        <div className="ml-auto flex gap-1">
          {summary.contradictionCount > 0 && (
            <Badge variant="destructive" className="text-[10px] px-1">
              {summary.contradictionCount}
            </Badge>
          )}
          {summary.suggestionCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1">
              {summary.suggestionCount}
            </Badge>
          )}
        </div>
      </button>

      {expanded && analysis && (
        <div className="border-t p-2 space-y-3 text-xs">
          {/* Summary update */}
          {analysis.summaryUpdate && (
            <div>
              <span className="font-medium">Summary:</span>{' '}
              <span className="text-muted-foreground">{analysis.summaryUpdate}</span>
            </div>
          )}

          {/* Mentioned characters */}
          {analysis.mentionedCharacters.length > 0 && (
            <div>
              <span className="font-medium">Characters:</span>{' '}
              {analysis.mentionedCharacters.map((id) => (
                <Badge key={id} variant="outline" className="text-[10px] mr-1">
                  {id}
                </Badge>
              ))}
            </div>
          )}

          {/* Contradictions */}
          {analysis.contradictions.length > 0 && (
            <div className="space-y-1">
              <span className="font-medium text-orange-600">Contradictions:</span>
              {analysis.contradictions.map((c, i) => (
                <div key={i} className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded p-1.5">
                  <p>{c.description}</p>
                  {c.fragmentIds.length > 0 && (
                    <p className="text-muted-foreground mt-0.5">
                      Related: {c.fragmentIds.join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Knowledge suggestions */}
          {analysis.knowledgeSuggestions.length > 0 && (
            <div className="space-y-1">
              <span className="font-medium text-blue-600">Suggestions:</span>
              {analysis.knowledgeSuggestions.map((s, i) => (
                <div key={i} className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded p-1.5 flex items-start justify-between gap-1">
                  <div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px]">{s.type ?? 'knowledge'}</Badge>
                      <p className="font-medium">{s.name}</p>
                    </div>
                    <p className="text-muted-foreground">{s.description}</p>
                  </div>
                  {onCreateFragment && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-5 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCreateFragment(s.type ?? 'knowledge', {
                          name: s.name,
                          description: s.description,
                          content: s.content,
                        })
                      }}
                    >
                      <Plus className="size-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Timeline events */}
          {analysis.timelineEvents.length > 0 && (
            <div className="space-y-1">
              <span className="font-medium">Timeline:</span>
              {analysis.timelineEvents.map((t, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px]">{t.position}</Badge>
                  <span>{t.event}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
