import { useEffect, useState, useMemo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  api,
  type ConversationMeta,
  type LibrarianAnalysis,
  type LibrarianAnalysisSummary,
  type LibrarianState,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  AlertTriangle,
  Brain,
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
  Trash2,
  ArrowLeft,
} from 'lucide-react'
import { RefinementPanel } from '@/components/refinement/RefinementPanel'
import { LibrarianChat } from '@/components/librarian/LibrarianChat'

interface LibrarianPanelProps {
  storyId: string
  askFragmentId?: string | null
  askPrefill?: string | null
  onAskFragmentConsumed?: () => void
}

type TabValue = 'chat' | 'story'

function tabStorageKey(storyId: string): string {
  return `errata.librarian.activeTab.${storyId}`
}

function readSavedTab(storyId: string): TabValue {
  if (typeof window === 'undefined') return 'chat'
  const saved = window.localStorage.getItem(tabStorageKey(storyId))
  if (saved === 'story') return saved
  return 'chat'
}

export function LibrarianPanel({ storyId, askFragmentId, askPrefill, onAskFragmentConsumed }: LibrarianPanelProps) {
  const [activeTab, setActiveTab] = useState<TabValue>(() => readSavedTab(storyId))
  const [chatInitialInput, setChatInitialInput] = useState<string>('')
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Fetch conversation list
  const { data: conversations } = useQuery({
    queryKey: ['librarian-conversations', storyId],
    queryFn: () => api.librarian.listConversations(storyId),
  })

  const createConversationMutation = useMutation({
    mutationFn: (title: string | undefined) => api.librarian.createConversation(storyId, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['librarian-conversations', storyId] })
    },
  })

  const deleteConversationMutation = useMutation({
    mutationFn: (conversationId: string) => api.librarian.deleteConversation(storyId, conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['librarian-conversations', storyId] })
    },
  })

  useEffect(() => {
    setActiveTab(readSavedTab(storyId))
    setActiveConversationId(null)
  }, [storyId])

  // Handle ask librarian from prose action panel — always create a new conversation
  useEffect(() => {
    if (!askFragmentId) return
    setActiveTab('chat')
    const prefill = askPrefill ?? `@${askFragmentId} `
    createConversationMutation.mutate(undefined, {
      onSuccess: (conversation) => {
        setActiveConversationId(conversation.id)
        setChatInitialInput(prefill)
      },
    })
    onAskFragmentConsumed?.()
  }, [askFragmentId, askPrefill, onAskFragmentConsumed])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(tabStorageKey(storyId), activeTab)
  }, [activeTab, storyId])

  const { data: status } = useQuery({
    queryKey: ['librarian-status', storyId],
    queryFn: () => api.librarian.getStatus(storyId),
    refetchInterval: 5000,
  })

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as TabValue)}
      className="h-full flex flex-col gap-0"
      data-component-id="librarian-panel-root"
    >
      {/* Tab bar */}
      <div className="shrink-0 px-4 pt-3">
        <TabsList variant="line" className="w-full h-8 gap-0">
          <TabsTrigger value="chat" className="text-[0.6875rem] gap-1.5 flex-1 px-1" data-component-id="librarian-tab-chat">
            <MessageSquare className="size-3" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="story" className="text-[0.6875rem] gap-1.5 flex-1 px-1" data-component-id="librarian-tab-story">
            <BookOpen className="size-3" />
            Story
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Tab content */}
      <TabsContent value="chat" className="flex-1 min-h-0 mt-0">
        {activeConversationId ? (
          <div className="flex flex-col h-full">
            {/* Conversation header */}
            <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-border/20">
              <button
                onClick={() => { setActiveConversationId(null); setChatInitialInput('') }}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                title="Back to conversations"
              >
                <ArrowLeft className="size-3" />
              </button>
              <span className="text-[0.6875rem] text-muted-foreground truncate flex-1">
                {conversations?.find(c => c.id === activeConversationId)?.title ?? 'Chat'}
              </span>
              <button
                onClick={() => {
                  deleteConversationMutation.mutate(activeConversationId, {
                    onSuccess: () => setActiveConversationId(null),
                  })
                }}
                className="text-muted-foreground/50 hover:text-destructive transition-colors p-0.5 rounded"
                title="Delete conversation"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <LibrarianChat storyId={storyId} conversationId={activeConversationId} initialInput={chatInitialInput} />
            </div>
          </div>
        ) : (
          <ConversationList
            conversations={conversations ?? []}
            onSelect={(id) => { setActiveConversationId(id); setChatInitialInput('') }}
            onNew={async () => {
              const conv = await createConversationMutation.mutateAsync(undefined)
              setActiveConversationId(conv.id)
              setChatInitialInput('')
            }}
            onDelete={(id) => deleteConversationMutation.mutate(id)}
          />
        )}
      </TabsContent>

      <TabsContent value="story" className="flex-1 min-h-0 mt-0">
        <StoryContent
          storyId={storyId}
          status={status}
          onOpenChat={(message) => {
            createConversationMutation.mutate(undefined, {
              onSuccess: (conversation) => {
                setActiveConversationId(conversation.id)
                setChatInitialInput(message)
                setActiveTab('chat')
              },
            })
          }}
        />
      </TabsContent>
    </Tabs>
  )
}

// ─── Conversation List ────────────────────────────────────

interface ConversationListProps {
  conversations: ConversationMeta[]
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

function ConversationList({ conversations, onSelect, onNew, onDelete }: ConversationListProps) {
  const sorted = useMemo(() =>
    [...conversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [conversations],
  )

  return (
    <div className="flex flex-col h-full">
      {/* New chat button */}
      <div className="shrink-0 px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-[0.6875rem] gap-1.5"
          onClick={onNew}
        >
          <Plus className="size-3" />
          New chat
        </Button>
      </div>

      {/* Conversation list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 pb-3 space-y-1">
          {sorted.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <MessageSquare className="size-5 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground italic max-w-[200px]">
                No conversations yet. Start a new chat to ask the librarian about your story.
              </p>
            </div>
          )}

          {sorted.map((conv) => {
            const date = new Date(conv.updatedAt)
            const timeStr = formatRelativeTime(date)

            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className="group w-full text-left rounded-md px-2.5 py-2 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <MessageSquare className="size-3 text-muted-foreground/50 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[0.6875rem] text-foreground/80 truncate leading-tight">
                      {conv.title}
                    </div>
                    <div className="text-[0.5625rem] text-muted-foreground/60 mt-0.5">
                      {timeStr}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(conv.id) }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all p-0.5 rounded shrink-0"
                    title="Delete conversation"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ─── Story Tab ─────────────────────────────────────────────

function StoryContent({ storyId, status, onOpenChat }: LibrarianPanelProps & { status: LibrarianState | undefined; onOpenChat?: (message: string) => void }) {
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
                <Badge variant="destructive" className="text-[0.625rem] gap-1 h-5">
                  <AlertTriangle className="size-2.5" />
                  {totalContradictions} contradiction{totalContradictions !== 1 ? 's' : ''}
                </Badge>
              )}
              {totalSuggestions > 0 && (
                <Badge variant="secondary" className="text-[0.625rem] gap-1 h-5">
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
                  onOpenChat={onOpenChat}
                  charName={charName}
                />
              ))}
            </div>
          </section>
        )}

        {!analyses?.length && !hasMentions && !hasTimeline && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="size-5 text-muted-foreground mb-3" />
            <p className="text-xs text-muted-foreground italic max-w-[220px]">
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
                  <span className="text-[0.6875rem] text-foreground/70">{charName(charId)}</span>
                  <span className="text-[0.625rem] font-mono text-muted-foreground">
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
                  <div key={`${entry.fragmentId}-${entry.event}-${i}`} className="flex items-start gap-2.5 py-1 pl-0 relative">
                    <span className="relative z-10 mt-[5px] size-[7px] rounded-full bg-muted-foreground/20 ring-2 ring-background shrink-0" />
                    <div className="min-w-0">
                      <span className="text-[0.6875rem] text-foreground/65 leading-snug block">{entry.event}</span>
                      <span className="text-[0.5625rem] font-mono text-muted-foreground">{entry.fragmentId}</span>
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
                  className="w-full rounded-md border border-border/30 bg-transparent px-2 py-1.5 text-[0.6875rem] text-muted-foreground hover:border-border/50 transition-colors cursor-pointer"
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
                <p className="text-[0.6875rem] text-muted-foreground italic">
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

// ─── Shared Components ─────────────────────────────────────

function SectionLabel({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 pt-2.5 pb-0.5">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <h4 className="text-[0.5625rem] text-muted-foreground uppercase tracking-[0.15em] font-medium">
        {children}
      </h4>
    </div>
  )
}

function AnalysisItem({
  storyId,
  summary,
  expanded,
  analysis,
  onToggle,
  onOpenChat,
  charName,
}: {
  storyId: string
  summary: LibrarianAnalysisSummary
  expanded: boolean
  analysis: LibrarianAnalysis | null
  onToggle: () => void
  onOpenChat?: (message: string) => void
  charName: (id: string) => string
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

  const handleAcceptSuggestion = (_suggestion: LibrarianAnalysis['fragmentSuggestions'][number], index: number) => {
    acceptMutation.mutate(index)
  }

  const pendingSuggestions = summary.pendingSuggestionCount
  const hasBadges = summary.contradictionCount > 0 || pendingSuggestions > 0

  return (
    <div className="rounded-md border border-border/25 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2.5 py-2 text-[0.6875rem] hover:bg-accent/30 transition-colors"
      >
        {expanded
          ? <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="size-3 text-muted-foreground shrink-0" />
        }
        <span className="font-mono text-foreground/60 truncate">{summary.fragmentId}</span>
        <span className="text-muted-foreground shrink-0">{timeStr}</span>
        {hasBadges && (
          <div className="ml-auto flex gap-1 shrink-0">
            {summary.contradictionCount > 0 && (
              <span className="inline-flex items-center justify-center size-4 rounded-full bg-destructive/15 text-destructive text-[0.5625rem] font-mono">
                {summary.contradictionCount}
              </span>
            )}
            {pendingSuggestions > 0 && (
              <span className="inline-flex items-center justify-center size-4 rounded-full bg-primary/10 text-primary text-[0.5625rem] font-mono">
                {pendingSuggestions}
              </span>
            )}
          </div>
        )}
      </button>

      {expanded && analysis && (
        <div className="border-t border-border/15 px-3 py-2.5 space-y-2.5 text-[0.6875rem] bg-muted/10">
          {analysis.summaryUpdate && (
            <div>
              <span className="text-muted-foreground text-[0.625rem]">Summary update</span>
              <p className="text-foreground/65 leading-relaxed mt-0.5">{analysis.summaryUpdate}</p>
            </div>
          )}

          {analysis.structuredSummary && (
            <div className="space-y-1.5">
              <span className="text-muted-foreground text-[0.625rem]">Structured summary</span>

              {analysis.structuredSummary.events.length > 0 && (
                <div>
                  <p className="text-[0.625rem] text-foreground/45 uppercase tracking-wide">Events</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {analysis.structuredSummary.events.map((event, i) => (
                      <li key={`structured-event-${i}`} className="text-foreground/60 leading-relaxed">
                        - {event}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.structuredSummary.stateChanges.length > 0 && (
                <div>
                  <p className="text-[0.625rem] text-foreground/45 uppercase tracking-wide">State changes</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {analysis.structuredSummary.stateChanges.map((change, i) => (
                      <li key={`structured-state-${i}`} className="text-foreground/60 leading-relaxed">
                        - {change}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.structuredSummary.openThreads.length > 0 && (
                <div>
                  <p className="text-[0.625rem] text-foreground/45 uppercase tracking-wide">Open threads</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {analysis.structuredSummary.openThreads.map((thread, i) => (
                      <li key={`structured-thread-${i}`} className="text-foreground/60 leading-relaxed">
                        - {thread}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {analysis.mentionedCharacters.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-muted-foreground text-[0.625rem] mr-1">Characters</span>
              {analysis.mentionedCharacters.map((id) => (
                <Badge key={id} variant="outline" className="text-[0.5625rem] h-4 px-1.5">
                  {charName(id)}
                </Badge>
              ))}
            </div>
          )}

          {analysis.contradictions.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-destructive/70 text-[0.625rem] font-medium">Contradictions</span>
              {analysis.contradictions.map((c, i) => {
                // Collect all unique fragment IDs: the analyzed prose + those cited in the contradiction
                const allIds = [...new Set([summary.fragmentId, ...c.fragmentIds])]
                return (
                  <div key={`contradiction-${c.fragmentIds.join('-')}-${i}`} className="bg-destructive/5 border border-destructive/10 rounded-md p-2">
                    <div className="flex items-start justify-between gap-1">
                      <div>
                        <p className="text-foreground/70">{c.description}</p>
                        {c.fragmentIds.length > 0 && (
                          <p className="text-muted-foreground mt-0.5 text-[0.625rem] font-mono">
                            {c.fragmentIds.join(', ')}
                          </p>
                        )}
                      </div>
                      {onOpenChat && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 text-[0.5625rem] gap-1 shrink-0 text-destructive/60 hover:text-destructive px-1.5"
                          onClick={(e) => {
                            e.stopPropagation()
                            const refs = allIds.map((id) => `@${id}`).join(' ')
                            onOpenChat(`Fix this contradiction: ${c.description}\n\n${refs}`)
                          }}
                        >
                          <MessageSquare className="size-2.5" />
                          Fix
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {analysis.fragmentSuggestions.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-primary/70 text-[0.625rem] font-medium">Suggestions</span>
              {analysis.fragmentSuggestions.map((s, i) => (
                <div
                  key={`${s.type ?? 'knowledge'}-${s.name}`}
                  className={`rounded-md p-2 flex items-start justify-between gap-1 ${
                    s.accepted
                      ? 'bg-emerald-500/5 border border-emerald-500/10 opacity-60'
                      : 'bg-primary/5 border border-primary/10'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <Badge variant="outline" className="text-[0.5625rem] h-3.5 px-1">{s.type ?? 'knowledge'}</Badge>
                      <span className="font-medium text-foreground/70">{s.name}</span>
                      {s.accepted && (
                        <Badge variant="secondary" className="text-[0.5625rem] h-3.5 gap-0.5 px-1">
                          <Check className="size-2" />
                          {s.targetFragmentId ? 'Updated' : 'Added'}
                        </Badge>
                      )}
                      {!s.accepted && s.targetFragmentId && (
                        <Badge variant="outline" className="text-[0.5625rem] h-3.5 px-1">
                          Update
                        </Badge>
                      )}
                      {s.accepted && s.autoApplied && (
                        <Badge variant="outline" className="text-[0.5625rem] h-3.5 px-1">
                          Auto
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5">{s.description}</p>
                    {s.targetFragmentId && (
                      <p className="text-[0.5625rem] text-muted-foreground mt-0.5 font-mono">
                        updates {s.targetFragmentId}
                      </p>
                    )}
                    {s.sourceFragmentId && (
                      <p className="text-[0.5625rem] text-muted-foreground mt-0.5 font-mono">
                        from {s.sourceFragmentId}
                      </p>
                    )}
                  </div>
                  {!s.accepted && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
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
              <span className="text-muted-foreground text-[0.625rem]">Timeline events</span>
              {analysis.timelineEvents.map((t) => (
                <div key={`${t.position}-${t.event}`} className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[0.5625rem] h-3.5 px-1">{t.position}</Badge>
                  <span className="text-foreground/60">{t.event}</span>
                </div>
              ))}
            </div>
          )}

          {/* Stored analysis trace */}
          {analysis.trace && analysis.trace.length > 0 && (
            <StoredTraceViewer trace={analysis.trace} />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Stored Trace Viewer ────────────────────────────────────

function StoredTraceViewer({ trace }: { trace: LibrarianAnalysis['trace'] }) {
  const [expanded, setExpanded] = useState(false)
  if (!trace || trace.length === 0) return null

  // Collapse reasoning deltas into blocks
  const items = collapseTraceEvents(trace)

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[0.625rem] text-muted-foreground hover:text-muted-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
        Analysis trace
        <span className="text-muted-foreground">({items.length})</span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1">
          {items.map((item, i) => (
            <TraceItem key={`${item.kind}-${i}`} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

type CollapsedTraceItem =
  | { kind: 'reasoning'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; toolName: string; args: Record<string, unknown> }
  | { kind: 'tool-result'; toolName: string; result: unknown }

function collapseTraceEvents(trace: LibrarianAnalysis['trace']): CollapsedTraceItem[] {
  if (!trace) return []
  const items: CollapsedTraceItem[] = []
  let reasoningBuf = ''
  let textBuf = ''

  for (const ev of trace) {
    if (ev.type === 'reasoning') {
      if (textBuf) { items.push({ kind: 'text', text: textBuf }); textBuf = '' }
      reasoningBuf += (ev as { text?: string }).text ?? ''
    } else if (ev.type === 'text') {
      if (reasoningBuf) { items.push({ kind: 'reasoning', text: reasoningBuf }); reasoningBuf = '' }
      textBuf += (ev as { text?: string }).text ?? ''
    } else {
      if (reasoningBuf) { items.push({ kind: 'reasoning', text: reasoningBuf }); reasoningBuf = '' }
      if (textBuf) { items.push({ kind: 'text', text: textBuf }); textBuf = '' }
      if (ev.type === 'tool-call') {
        const tc = ev as { toolName?: string; args?: Record<string, unknown> }
        items.push({ kind: 'tool-call', toolName: tc.toolName ?? '', args: tc.args ?? {} })
      } else if (ev.type === 'tool-result') {
        const tr = ev as { toolName?: string; result?: unknown }
        items.push({ kind: 'tool-result', toolName: tr.toolName ?? '', result: tr.result })
      }
    }
  }
  if (reasoningBuf) items.push({ kind: 'reasoning', text: reasoningBuf })
  if (textBuf) items.push({ kind: 'text', text: textBuf })
  return items
}

function TraceItem({ item }: { item: CollapsedTraceItem }) {
  const [expanded, setExpanded] = useState(false)

  if (item.kind === 'reasoning') {
    return (
      <div className="rounded-md border border-border/15 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-1.5 px-2 py-1 text-[0.625rem] hover:bg-accent/20 transition-colors"
        >
          <Brain className="size-3 text-purple-400/60 shrink-0" />
          <span className="text-muted-foreground">Reasoning</span>
          <span className="text-muted-foreground ml-auto">{item.text.length} chars</span>
        </button>
        {expanded && (
          <div className="border-t border-border/10 px-2 py-1.5">
            <p className="text-[0.625rem] text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
              {item.text}
            </p>
          </div>
        )}
      </div>
    )
  }

  if (item.kind === 'text') {
    return (
      <div className="px-2 py-0.5">
        <p className="text-[0.625rem] text-foreground/50 leading-relaxed">{item.text}</p>
      </div>
    )
  }

  if (item.kind === 'tool-call') {
    return (
      <div className="rounded-md border border-border/15 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-1.5 px-2 py-1 text-[0.625rem] hover:bg-accent/20 transition-colors"
        >
          <Wrench className="size-3 text-blue-400/60 shrink-0" />
          <Badge variant="outline" className="text-[0.5625rem] h-3.5 px-1">{item.toolName}</Badge>
        </button>
        {expanded && (
          <div className="border-t border-border/10 px-2 py-1.5">
            <pre className="text-[0.5625rem] text-muted-foreground leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify(item.args, null, 2)}
            </pre>
          </div>
        )}
      </div>
    )
  }

  if (item.kind === 'tool-result') {
    return (
      <div className="px-2 py-0.5 flex items-center gap-1">
        <Check className="size-2.5 text-emerald-500/50" />
        <span className="text-[0.5625rem] text-muted-foreground">{item.toolName} completed</span>
      </div>
    )
  }

  return null
}

