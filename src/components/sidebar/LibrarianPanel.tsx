import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  api,
  type LibrarianAnalysis,
  type LibrarianAnalysisSummary,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  AlertTriangle,
  Lightbulb,
  Clock,
  Users,
  ChevronDown,
  ChevronRight,
  Plus,
  Check,
  Sparkles,
  Wrench,
  MessageSquare,
  Activity,
} from 'lucide-react'
import { RefinementPanel } from '@/components/refinement/RefinementPanel'
import { LibrarianChat } from '@/components/librarian/LibrarianChat'

interface LibrarianPanelProps {
  storyId: string
}

export function LibrarianPanel({ storyId }: LibrarianPanelProps) {
  return (
    <Tabs defaultValue="chat" className="h-full flex flex-col gap-0">
      <div className="px-3 pt-2 shrink-0">
        <TabsList className="w-full h-8">
          <TabsTrigger value="chat" className="text-xs gap-1 flex-1">
            <MessageSquare className="size-3" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-xs gap-1 flex-1">
            <Activity className="size-3" />
            Activity
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="chat" className="flex-1 min-h-0 mt-0">
        <LibrarianChat storyId={storyId} />
      </TabsContent>

      <TabsContent value="activity" className="flex-1 min-h-0 mt-0">
        <ActivityContent storyId={storyId} />
      </TabsContent>
    </Tabs>
  )
}

function ActivityContent({ storyId }: LibrarianPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refineTarget, setRefineTarget] = useState<{ fragmentId: string; fragmentName: string; instructions?: string } | null>(null)

  const { data: characters } = useQuery({
    queryKey: ['fragments', storyId, 'character'],
    queryFn: () => api.fragments.list(storyId, 'character'),
  })

  const { data: guidelines } = useQuery({
    queryKey: ['fragments', storyId, 'guideline'],
    queryFn: () => api.fragments.list(storyId, 'guideline'),
  })

  const { data: knowledge } = useQuery({
    queryKey: ['fragments', storyId, 'knowledge'],
    queryFn: () => api.fragments.list(storyId, 'knowledge'),
  })

  const refinableFragments = [
    ...(characters ?? []),
    ...(guidelines ?? []),
    ...(knowledge ?? []),
  ].filter((f) => !f.archived)

  const charName = (id: string) => characters?.find((c) => c.id === id)?.name ?? id

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
          <h4 className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2">Status</h4>
          <div className="flex items-center gap-2 text-sm">
            <div className="size-1.5 rounded-full bg-green-500/70" />
            <span className="text-sm">Idle</span>
          </div>
          {status?.lastAnalyzedFragmentId && (
            <p className="text-[10px] text-muted-foreground/40 mt-1">
              Last analyzed: <span className="font-mono">{status.lastAnalyzedFragmentId}</span>
            </p>
          )}
        </div>

        <div className="h-px bg-border/30" />

        {/* Summary badges */}
        <div className="flex gap-1.5 flex-wrap">
          {totalContradictions > 0 && (
            <Badge variant="destructive" className="text-xs gap-1">
              <AlertTriangle className="size-3" />
              {totalContradictions} contradiction{totalContradictions !== 1 ? 's' : ''}
            </Badge>
          )}
          {totalSuggestions > 0 && (
            <Badge variant="secondary" className="text-xs gap-1">
              <Lightbulb className="size-3" />
              {totalSuggestions} suggestion{totalSuggestions !== 1 ? 's' : ''}
            </Badge>
          )}
          {analyses?.length === 0 && (
            <p className="text-xs text-muted-foreground/40 italic">No analyses yet. Generate some prose to get started.</p>
          )}
        </div>

        {/* Character mentions */}
        {status && Object.keys(status.recentMentions).length > 0 && (
          <>
            <div className="h-px bg-border/30" />
            <div>
              <h4 className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Users className="size-3" />
                Character Mentions
              </h4>
              <div className="space-y-1">
                {Object.entries(status.recentMentions).map(([charId, fragmentIds]) => (
                  <div key={charId} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground/60">{charName(charId)}</span>
                    <Badge variant="outline" className="text-[10px] h-4">
                      {fragmentIds.length}
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
            <div className="h-px bg-border/30" />
            <div>
              <h4 className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Clock className="size-3" />
                Timeline
              </h4>
              <div className="space-y-1">
                {status.timeline.slice(-10).map((entry, i) => (
                  <div key={i} className="text-xs flex gap-2">
                    <span className="font-mono text-muted-foreground/40 shrink-0">{entry.fragmentId}</span>
                    <span className="text-muted-foreground/70">{entry.event}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="h-px bg-border/30" />

        {/* Refine Fragment */}
        <div>
          <h4 className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Sparkles className="size-3" />
            Refine Fragment
          </h4>
          {refineTarget ? (
            <RefinementPanel
              storyId={storyId}
              fragmentId={refineTarget.fragmentId}
              fragmentName={refineTarget.fragmentName}
              onComplete={() => setRefineTarget(null)}
              onClose={() => setRefineTarget(null)}
            />
          ) : (
            <div className="space-y-2">
              {refinableFragments.length > 0 ? (
                <select
                  className="w-full rounded-md border border-border/40 bg-transparent px-2 py-1.5 text-xs"
                  defaultValue=""
                  onChange={(e) => {
                    const f = refinableFragments.find((f) => f.id === e.target.value)
                    if (f) {
                      setRefineTarget({ fragmentId: f.id, fragmentName: f.name })
                    }
                  }}
                >
                  <option value="" disabled>Select a fragment to refine...</option>
                  {refinableFragments.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} ({f.type})</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground/40 italic">No refinable fragments. Create characters, guidelines, or knowledge first.</p>
              )}
            </div>
          )}
        </div>

        <div className="h-px bg-border/30" />

        {/* Analyses list */}
        <div>
          <h4 className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2">
            Recent Analyses
          </h4>
          <div className="space-y-1.5">
            {analyses?.map((summary) => (
              <AnalysisItem
                key={summary.id}
                storyId={storyId}
                summary={summary}
                expanded={expandedId === summary.id}
                analysis={expandedId === summary.id ? expandedAnalysis ?? null : null}
                onToggle={() => setExpandedId(expandedId === summary.id ? null : summary.id)}
                onRefineFragment={(fragmentId, fragmentName, instructions) =>
                  setRefineTarget({ fragmentId, fragmentName, instructions })
                }
                charName={charName}
                refinableFragments={refinableFragments}
              />
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

function AnalysisItem({
  storyId,
  summary,
  expanded,
  analysis,
  onToggle,
  onRefineFragment,
  charName,
  refinableFragments,
}: {
  storyId: string
  summary: LibrarianAnalysisSummary
  expanded: boolean
  analysis: LibrarianAnalysis | null
  onToggle: () => void
  onRefineFragment?: (fragmentId: string, fragmentName: string, instructions: string) => void
  charName: (id: string) => string
  refinableFragments?: Array<{ id: string; name: string; type: string }>
}) {
  const queryClient = useQueryClient()
  const date = new Date(summary.createdAt)
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const acceptMutation = useMutation({
    mutationFn: (index: number) =>
      api.librarian.acceptSuggestion(storyId, summary.id, index),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['librarian-analyses', storyId] })
      queryClient.invalidateQueries({ queryKey: ['librarian-analysis', storyId, summary.id] })
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    },
  })

  const handleAcceptSuggestion = (s: LibrarianAnalysis['knowledgeSuggestions'][number], index: number) => {
    acceptMutation.mutate(index)
  }

  return (
    <div className="rounded-lg border border-border/30">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-2.5 text-xs hover:bg-card/30 transition-colors rounded-lg"
      >
        {expanded ? <ChevronDown className="size-3 text-muted-foreground/40" /> : <ChevronRight className="size-3 text-muted-foreground/40" />}
        <span className="font-mono text-muted-foreground/60">{summary.fragmentId}</span>
        <span className="text-muted-foreground/40">{timeStr}</span>
        <div className="ml-auto flex gap-1">
          {summary.contradictionCount > 0 && (
            <Badge variant="destructive" className="text-[10px] h-4 px-1">
              {summary.contradictionCount}
            </Badge>
          )}
          {summary.suggestionCount > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1">
              {summary.suggestionCount}
            </Badge>
          )}
        </div>
      </button>

      {expanded && analysis && (
        <div className="border-t border-border/20 p-2.5 space-y-3 text-xs">
          {analysis.summaryUpdate && (
            <div>
              <span className="font-medium">Summary:</span>{' '}
              <span className="text-muted-foreground/70">{analysis.summaryUpdate}</span>
            </div>
          )}

          {analysis.mentionedCharacters.length > 0 && (
            <div>
              <span className="font-medium">Characters:</span>{' '}
              {analysis.mentionedCharacters.map((id) => (
                <Badge key={id} variant="outline" className="text-[10px] mr-1 h-4">
                  {charName(id)}
                </Badge>
              ))}
            </div>
          )}

          {analysis.contradictions.length > 0 && (
            <div className="space-y-1">
              <span className="font-medium text-destructive/80">Contradictions:</span>
              {analysis.contradictions.map((c, i) => {
                const fixableId = c.fragmentIds.find((fid) =>
                  refinableFragments?.some((rf) => rf.id === fid)
                )
                const fixableFragment = fixableId
                  ? refinableFragments?.find((rf) => rf.id === fixableId)
                  : null
                return (
                  <div key={i} className="bg-destructive/5 border border-destructive/10 rounded-md p-2">
                    <div className="flex items-start justify-between gap-1">
                      <div>
                        <p>{c.description}</p>
                        {c.fragmentIds.length > 0 && (
                          <p className="text-muted-foreground/50 mt-0.5">
                            Related: {c.fragmentIds.join(', ')}
                          </p>
                        )}
                      </div>
                      {fixableFragment && onRefineFragment && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] gap-1 shrink-0 text-destructive/70 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            onRefineFragment(
                              fixableFragment.id,
                              fixableFragment.name,
                              `Fix this contradiction: ${c.description}`,
                            )
                          }}
                        >
                          <Wrench className="size-3" />
                          Fix
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {analysis.knowledgeSuggestions.length > 0 && (
            <div className="space-y-1">
              <span className="font-medium text-primary/80">Suggestions:</span>
              {analysis.knowledgeSuggestions.map((s, i) => (
                <div
                  key={i}
                  className={`rounded-md p-2 flex items-start justify-between gap-1 ${
                    s.accepted
                      ? 'bg-green-500/5 border border-green-500/10 opacity-60'
                      : 'bg-primary/5 border border-primary/10'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] h-3.5">{s.type ?? 'knowledge'}</Badge>
                      <p className="font-medium">{s.name}</p>
                      {s.accepted && (
                        <Badge variant="secondary" className="text-[10px] h-3.5 gap-0.5">
                          <Check className="size-2" />
                          Added
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground/60">{s.description}</p>
                  </div>
                  {!s.accepted && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-5 shrink-0 text-muted-foreground/50 hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAcceptSuggestion(s, i)
                      }}
                    >
                      <Plus className="size-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {analysis.timelineEvents.length > 0 && (
            <div className="space-y-1">
              <span className="font-medium">Timeline:</span>
              {analysis.timelineEvents.map((t, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px] h-3.5">{t.position}</Badge>
                  <span className="text-muted-foreground/70">{t.event}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
