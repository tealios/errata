import { useEffect, useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  api,
  type AgentRunTraceRecord,
  type LibrarianAnalysis,
  type LibrarianAnalysisSummary,
  type LibrarianState,
} from '@/lib/api'
import { useHelp } from '@/hooks/use-help'
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
  BookOpen,
  Radio,
  GitBranch,
  CircleHelp,
} from 'lucide-react'
import { RefinementPanel } from '@/components/refinement/RefinementPanel'
import { LibrarianChat } from '@/components/librarian/LibrarianChat'

interface LibrarianPanelProps {
  storyId: string
}

type TabValue = 'chat' | 'story' | 'activity'

function tabStorageKey(storyId: string): string {
  return `errata.librarian.activeTab.${storyId}`
}

function readSavedTab(storyId: string): TabValue {
  if (typeof window === 'undefined') return 'chat'
  const saved = window.localStorage.getItem(tabStorageKey(storyId))
  if (saved === 'story' || saved === 'activity') return saved
  return 'chat'
}

export function LibrarianPanel({ storyId }: LibrarianPanelProps) {
  const [activeTab, setActiveTab] = useState<TabValue>(() => readSavedTab(storyId))
  const { openHelp } = useHelp()
  const queryClient = useQueryClient()

  useEffect(() => {
    setActiveTab(readSavedTab(storyId))
  }, [storyId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(tabStorageKey(storyId), activeTab)
  }, [activeTab, storyId])

  const { data: status } = useQuery({
    queryKey: ['librarian-status', storyId],
    queryFn: () => api.librarian.getStatus(storyId),
    refetchInterval: 5000,
  })

  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })

  const updateMutation = useMutation({
    mutationFn: (data: { autoApplyLibrarianSuggestions?: boolean }) =>
      api.settings.update(storyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
    },
  })

  const autoApply = story?.settings.autoApplyLibrarianSuggestions ?? false
  const toggleAutoApply = useCallback(() => {
    updateMutation.mutate({ autoApplyLibrarianSuggestions: !autoApply })
  }, [autoApply, updateMutation])

  const runStatus = status?.runStatus ?? 'idle'

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as TabValue)}
      className="h-full flex flex-col gap-0"
    >
      {/* Tab bar */}
      <div className="shrink-0 px-4 pt-3">
        <TabsList variant="line" className="w-full h-8 gap-0">
          <TabsTrigger value="chat" className="text-[11px] gap-1.5 flex-1 px-1">
            <MessageSquare className="size-3" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="story" className="text-[11px] gap-1.5 flex-1 px-1">
            <BookOpen className="size-3" />
            Story
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-[11px] gap-1.5 flex-1 px-1">
            <Radio className="size-3" />
            Activity
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Status strip — always visible */}
      <StatusStrip status={status} runStatus={runStatus} />

      {/* Auto-apply toggle */}
      <div className="shrink-0 mx-4 mb-1">
        <div className="flex items-center justify-between h-6 px-2.5 rounded-md bg-muted/40">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground/60">Auto-apply suggestions</span>
            <button
              type="button"
              onClick={() => openHelp('librarian#auto-suggestions')}
              className="text-muted-foreground/25 hover:text-primary/60 transition-colors"
              title="Learn more"
            >
              <CircleHelp className="size-2.5" />
            </button>
          </div>
          <button
            onClick={toggleAutoApply}
            disabled={updateMutation.isPending}
            className={`relative shrink-0 h-[14px] w-[26px] rounded-full transition-colors ${
              autoApply ? 'bg-foreground' : 'bg-muted-foreground/20'
            }`}
            aria-label="Toggle auto-apply suggestions"
          >
            <span
              className={`absolute top-[2px] h-[10px] w-[10px] rounded-full bg-background transition-[left] duration-150 ${
                autoApply ? 'left-[14px]' : 'left-[2px]'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Tab content */}
      <TabsContent value="chat" className="flex-1 min-h-0 mt-0">
        <LibrarianChat storyId={storyId} />
      </TabsContent>

      <TabsContent value="story" className="flex-1 min-h-0 mt-0">
        <StoryContent storyId={storyId} status={status} />
      </TabsContent>

      <TabsContent value="activity" className="flex-1 min-h-0 mt-0">
        <ActivityContent storyId={storyId} />
      </TabsContent>
    </Tabs>
  )
}

// ─── Status Strip ──────────────────────────────────────────

interface StatusStripProps {
  status: {
    runStatus?: string
    pendingFragmentId?: string | null
    runningFragmentId?: string | null
    lastError?: string | null
    lastAnalyzedFragmentId: string | null
  } | undefined
  runStatus: string
}

function StatusStrip({ status, runStatus }: StatusStripProps) {
  const isActive = runStatus === 'running' || runStatus === 'scheduled'
  const isError = runStatus === 'error'

  const dotColor = runStatus === 'running'
    ? 'bg-blue-400'
    : runStatus === 'scheduled'
      ? 'bg-amber-400'
      : isError
        ? 'bg-red-400'
        : 'bg-emerald-500/50'

  const label = runStatus === 'running'
    ? 'Analyzing'
    : runStatus === 'scheduled'
      ? 'Queued'
      : isError
        ? 'Error'
        : 'Idle'

  const fragmentId = runStatus === 'running'
    ? status?.runningFragmentId
    : runStatus === 'scheduled'
      ? status?.pendingFragmentId
      : status?.lastAnalyzedFragmentId

  return (
    <div className="shrink-0 mx-4 mt-2 mb-1">
      <div className="flex items-center gap-2 h-6 px-2.5 rounded-md bg-muted/40">
        {/* Animated dot */}
        <span className="relative flex size-2">
          {isActive && (
            <span
              className={`absolute inset-0 rounded-full ${dotColor} animate-ping`}
              style={{ animationDuration: '2s' }}
            />
          )}
          <span className={`relative inline-flex size-2 rounded-full ${dotColor}`} />
        </span>

        <span className="text-[10px] text-muted-foreground/60 tracking-wide">
          {label}
        </span>

        {fragmentId && (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-[10px] font-mono text-muted-foreground/40 truncate">
              {fragmentId}
            </span>
          </>
        )}

        {isError && status?.lastError && (
          <span className="text-[10px] text-red-500/70 truncate ml-auto" title={status.lastError}>
            {status.lastError.length > 30 ? status.lastError.slice(0, 30) + '\u2026' : status.lastError}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Story Tab ─────────────────────────────────────────────

function StoryContent({ storyId, status }: LibrarianPanelProps & { status: LibrarianState | undefined }) {
  const [refineTarget, setRefineTarget] = useState<{ fragmentId: string; fragmentName: string; instructions?: string } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

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

  const refinableFragments = useMemo(() => [
    ...(characters ?? []),
    ...(guidelines ?? []),
    ...(knowledge ?? []),
  ].filter((f) => !f.archived), [characters, guidelines, knowledge])

  const charName = (id: string) => characters?.find((c) => c.id === id)?.name ?? id

  const totalContradictions = analyses?.reduce((n, a) => n + a.contradictionCount, 0) ?? 0
  const totalSuggestions = analyses?.reduce((n, a) => n + a.pendingSuggestionCount, 0) ?? 0
  const hasMentions = status && Object.keys(status.recentMentions ?? {}).length > 0
  const hasTimeline = status && (status.timeline?.length ?? 0) > 0
  const hasFindings = totalContradictions > 0 || totalSuggestions > 0

  return (
    <ScrollArea className="h-full">
      <div className="px-4 py-3 space-y-1">

        {/* Findings overview */}
        {hasFindings && (
          <section>
            <SectionLabel>Findings</SectionLabel>
            <div className="flex gap-1.5 flex-wrap mt-1.5">
              {totalContradictions > 0 && (
                <Badge variant="destructive" className="text-[10px] gap-1 h-5">
                  <AlertTriangle className="size-2.5" />
                  {totalContradictions} contradiction{totalContradictions !== 1 ? 's' : ''}
                </Badge>
              )}
              {totalSuggestions > 0 && (
                <Badge variant="secondary" className="text-[10px] gap-1 h-5">
                  <Lightbulb className="size-2.5" />
                  {totalSuggestions} suggestion{totalSuggestions !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>
          </section>
        )}

        {/* Recent analyses with inline findings */}
        {analyses && analyses.length > 0 && (
          <section>
            {!hasFindings && <SectionLabel>Analyses</SectionLabel>}
            {hasFindings && <div className="h-2" />}
            <div className="space-y-1.5">
              {analyses.slice(0, 6).map((summary) => (
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
          </section>
        )}

        {!analyses?.length && !hasMentions && !hasTimeline && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="size-5 text-muted-foreground/20 mb-3" />
            <p className="text-xs text-muted-foreground/40 italic max-w-[220px]">
              Generate some prose and the librarian will track your story here.
            </p>
          </div>
        )}

        {/* Character mentions */}
        {hasMentions && status && (
          <section>
            <SectionLabel icon={<Users className="size-3" />}>Characters</SectionLabel>
            <div className="space-y-0.5 mt-1.5">
              {Object.entries(status.recentMentions ?? {}).map(([charId, fragmentIds]) => (
                <div key={charId} className="flex items-center justify-between py-1 px-2 rounded-md hover:bg-accent/30 transition-colors">
                  <span className="text-[11px] text-foreground/70">{charName(charId)}</span>
                  <span className="text-[10px] font-mono text-muted-foreground/35">
                    {fragmentIds.length} mention{fragmentIds.length !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Timeline */}
        {hasTimeline && status && (
          <section>
            <SectionLabel icon={<Clock className="size-3" />}>Timeline</SectionLabel>
            <div className="mt-1.5 relative">
              {/* Vertical thread line */}
              <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border/40" />
              <div className="space-y-0">
                {status.timeline.slice(-10).map((entry, i) => (
                  <div key={i} className="flex items-start gap-2.5 py-1 pl-0 relative">
                    <span className="relative z-10 mt-[5px] size-[7px] rounded-full bg-muted-foreground/20 ring-2 ring-background shrink-0" />
                    <div className="min-w-0">
                      <span className="text-[11px] text-foreground/65 leading-snug block">{entry.event}</span>
                      <span className="text-[9px] font-mono text-muted-foreground/30">{entry.fragmentId}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Refine */}
        <section>
          <SectionLabel icon={<Sparkles className="size-3" />}>Refine</SectionLabel>
          <div className="mt-1.5">
            {refineTarget ? (
              <RefinementPanel
                storyId={storyId}
                fragmentId={refineTarget.fragmentId}
                fragmentName={refineTarget.fragmentName}
                onComplete={() => setRefineTarget(null)}
                onClose={() => setRefineTarget(null)}
              />
            ) : (
              refinableFragments.length > 0 ? (
                <select
                  className="w-full rounded-md border border-border/30 bg-transparent px-2 py-1.5 text-[11px] text-muted-foreground/70 hover:border-border/50 transition-colors cursor-pointer"
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
                <p className="text-[11px] text-muted-foreground/35 italic">
                  No fragments to refine yet.
                </p>
              )
            )}
          </div>
        </section>

      </div>
    </ScrollArea>
  )
}

// ─── Activity Tab ──────────────────────────────────────────

function ActivityContent({ storyId }: LibrarianPanelProps) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  const { data: agentRuns } = useQuery({
    queryKey: ['librarian-agent-runs', storyId],
    queryFn: () => api.librarian.listAgentRuns(storyId),
    refetchInterval: 3000,
  })

  const hasRuns = agentRuns && agentRuns.length > 0

  return (
    <ScrollArea className="h-full">
      <div className="px-4 py-3 space-y-1">

        {/* Agent runs */}
        <section>
          <SectionLabel icon={<GitBranch className="size-3" />}>Agent Runs</SectionLabel>
          {hasRuns ? (
            <div className="space-y-1 mt-1.5">
              {agentRuns.slice(0, 12).map((run) => {
                const expanded = expandedRunId === run.rootRunId
                const runTime = new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                const isError = run.status === 'error'
                return (
                  <div key={run.rootRunId} className="rounded-md border border-border/25 overflow-hidden">
                    <button
                      onClick={() => setExpandedRunId(expanded ? null : run.rootRunId)}
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 text-[11px] hover:bg-accent/30 transition-colors"
                    >
                      {expanded
                        ? <ChevronDown className="size-3 text-muted-foreground/35 shrink-0" />
                        : <ChevronRight className="size-3 text-muted-foreground/35 shrink-0" />
                      }
                      <span className="font-mono text-foreground/65 truncate">{run.agentName}</span>
                      <span className="text-muted-foreground/30 shrink-0">{runTime}</span>
                      <span className="text-muted-foreground/30 shrink-0">{formatDuration(run.durationMs)}</span>
                      <span className={`ml-auto text-[9px] font-mono shrink-0 ${isError ? 'text-red-500/70' : 'text-emerald-500/50'}`}>
                        {run.status}
                      </span>
                    </button>
                    {expanded && <TraceTree run={run} />}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Radio className="size-5 text-muted-foreground/20 mb-3" />
              <p className="text-xs text-muted-foreground/40 italic max-w-[220px]">
                No activity yet. The librarian runs automatically after each generation.
              </p>
            </div>
          )}
        </section>

      </div>
    </ScrollArea>
  )
}

// ─── Shared Components ─────────────────────────────────────

function SectionLabel({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 pt-2.5 pb-0.5">
      {icon && <span className="text-muted-foreground/30">{icon}</span>}
      <h4 className="text-[9px] text-muted-foreground/40 uppercase tracking-[0.15em] font-medium">
        {children}
      </h4>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function TraceTree({ run }: { run: AgentRunTraceRecord }) {
  const byParent = new Map<string | null, AgentRunTraceRecord['trace']>()
  for (const entry of run.trace) {
    const key = entry.parentRunId ?? null
    const list = byParent.get(key) ?? []
    list.push(entry)
    byParent.set(key, list)
  }
  for (const [, list] of byParent.entries()) {
    list.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  const roots = byParent.get(null) ?? []

  const renderNode = (node: AgentRunTraceRecord['trace'][number], depth: number) => {
    const children = byParent.get(node.runId) ?? []
    return (
      <div key={node.runId}>
        <div
          className="flex items-start gap-1.5 text-[10px] py-0.5"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          <span className="text-muted-foreground/25 mt-px">{depth === 0 ? '\u25CF' : '\u2514'}</span>
          <span className="font-mono text-foreground/70">{node.agentName}</span>
          <span className="text-muted-foreground/30">{formatDuration(node.durationMs)}</span>
          <span className={node.status === 'error' ? 'text-red-500/70' : 'text-emerald-500/50'}>
            {node.status}
          </span>
        </div>
        {node.error && (
          <p
            className="text-[9px] text-red-500/60 leading-tight"
            style={{ paddingLeft: `${depth * 12 + 20}px` }}
          >
            {node.error}
          </p>
        )}
        {children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="border-t border-border/15 px-1 py-2 bg-muted/15">
      {roots.map((root) => renderNode(root, 0))}
      {run.error && (
        <p className="text-[9px] text-red-500/60 px-2 mt-1">{run.error}</p>
      )}
    </div>
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

  const handleAcceptSuggestion = (_suggestion: LibrarianAnalysis['knowledgeSuggestions'][number], index: number) => {
    acceptMutation.mutate(index)
  }

  const pendingSuggestions = summary.pendingSuggestionCount
  const hasBadges = summary.contradictionCount > 0 || pendingSuggestions > 0

  return (
    <div className="rounded-md border border-border/25 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2.5 py-2 text-[11px] hover:bg-accent/30 transition-colors"
      >
        {expanded
          ? <ChevronDown className="size-3 text-muted-foreground/35 shrink-0" />
          : <ChevronRight className="size-3 text-muted-foreground/35 shrink-0" />
        }
        <span className="font-mono text-foreground/60 truncate">{summary.fragmentId}</span>
        <span className="text-muted-foreground/30 shrink-0">{timeStr}</span>
        {hasBadges && (
          <div className="ml-auto flex gap-1 shrink-0">
            {summary.contradictionCount > 0 && (
              <span className="inline-flex items-center justify-center size-4 rounded-full bg-destructive/15 text-destructive text-[9px] font-mono">
                {summary.contradictionCount}
              </span>
            )}
            {pendingSuggestions > 0 && (
              <span className="inline-flex items-center justify-center size-4 rounded-full bg-primary/10 text-primary text-[9px] font-mono">
                {pendingSuggestions}
              </span>
            )}
          </div>
        )}
      </button>

      {expanded && analysis && (
        <div className="border-t border-border/15 px-3 py-2.5 space-y-2.5 text-[11px] bg-muted/10">
          {analysis.summaryUpdate && (
            <div>
              <span className="text-muted-foreground/45 text-[10px]">Summary update</span>
              <p className="text-foreground/65 leading-relaxed mt-0.5">{analysis.summaryUpdate}</p>
            </div>
          )}

          {analysis.mentionedCharacters.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-muted-foreground/45 text-[10px] mr-1">Characters</span>
              {analysis.mentionedCharacters.map((id) => (
                <Badge key={id} variant="outline" className="text-[9px] h-4 px-1.5">
                  {charName(id)}
                </Badge>
              ))}
            </div>
          )}

          {analysis.contradictions.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-destructive/70 text-[10px] font-medium">Contradictions</span>
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
                        <p className="text-foreground/70">{c.description}</p>
                        {c.fragmentIds.length > 0 && (
                          <p className="text-muted-foreground/40 mt-0.5 text-[10px] font-mono">
                            {c.fragmentIds.join(', ')}
                          </p>
                        )}
                      </div>
                      {fixableFragment && onRefineFragment && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 text-[9px] gap-1 shrink-0 text-destructive/60 hover:text-destructive px-1.5"
                          onClick={(e) => {
                            e.stopPropagation()
                            onRefineFragment(
                              fixableFragment.id,
                              fixableFragment.name,
                              `Fix this contradiction: ${c.description}`,
                            )
                          }}
                        >
                          <Wrench className="size-2.5" />
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
            <div className="space-y-1.5">
              <span className="text-primary/70 text-[10px] font-medium">Suggestions</span>
              {analysis.knowledgeSuggestions.map((s, i) => (
                <div
                  key={i}
                  className={`rounded-md p-2 flex items-start justify-between gap-1 ${
                    s.accepted
                      ? 'bg-emerald-500/5 border border-emerald-500/10 opacity-60'
                      : 'bg-primary/5 border border-primary/10'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <Badge variant="outline" className="text-[9px] h-3.5 px-1">{s.type ?? 'knowledge'}</Badge>
                      <span className="font-medium text-foreground/70">{s.name}</span>
                      {s.accepted && (
                        <Badge variant="secondary" className="text-[9px] h-3.5 gap-0.5 px-1">
                          <Check className="size-2" />
                          {s.targetFragmentId ? 'Updated' : 'Added'}
                        </Badge>
                      )}
                      {!s.accepted && s.targetFragmentId && (
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                          Update
                        </Badge>
                      )}
                      {s.accepted && s.autoApplied && (
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                          Auto
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground/50 mt-0.5">{s.description}</p>
                    {s.targetFragmentId && (
                      <p className="text-[9px] text-muted-foreground/35 mt-0.5 font-mono">
                        updates {s.targetFragmentId}
                      </p>
                    )}
                    {s.sourceFragmentId && (
                      <p className="text-[9px] text-muted-foreground/35 mt-0.5 font-mono">
                        from {s.sourceFragmentId}
                      </p>
                    )}
                  </div>
                  {!s.accepted && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-5 shrink-0 text-muted-foreground/40 hover:text-foreground"
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
              <span className="text-muted-foreground/45 text-[10px]">Timeline events</span>
              {analysis.timelineEvents.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1">{t.position}</Badge>
                  <span className="text-foreground/60">{t.event}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
