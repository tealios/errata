import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  api,
  type AgentRunTraceRecord,
  type ChatEvent,
  type LibrarianState,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Check,
  Wrench,
  Radio,
  GitBranch,
} from 'lucide-react'

interface AgentActivityPanelProps {
  storyId: string
}

export function AgentActivityPanel({ storyId }: AgentActivityPanelProps) {
  const { data: status } = useQuery({
    queryKey: ['librarian-status', storyId],
    queryFn: () => api.librarian.getStatus(storyId),
    refetchInterval: 5000,
  })

  const runStatus = status?.runStatus ?? 'idle'

  return (
    <div className="h-full flex flex-col">
      {/* Status strip */}
      <StatusStrip status={status} runStatus={runStatus} />

      {/* Live analysis trace */}
      {runStatus === 'running' && (
        <LiveAnalysisTrace storyId={storyId} />
      )}

      {/* Agent runs */}
      <div className="flex-1 min-h-0">
        <ActivityContent storyId={storyId} />
      </div>
    </div>
  )
}

// ─── Status Strip ──────────────────────────────────────────

interface StatusStripProps {
  status: LibrarianState | undefined
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
    <div className="shrink-0 mx-4 mt-3 mb-1">
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

        <span className="text-[0.625rem] text-muted-foreground tracking-wide">
          {label}
        </span>

        {fragmentId && (
          <>
            <span className="text-muted-foreground">&middot;</span>
            <span className="text-[0.625rem] font-mono text-muted-foreground truncate">
              {fragmentId}
            </span>
          </>
        )}

        {isError && status?.lastError && (
          <span className="text-[0.625rem] text-red-500/70 truncate ml-auto" title={status.lastError}>
            {status.lastError.length > 30 ? status.lastError.slice(0, 30) + '\u2026' : status.lastError}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Activity Content ─────────────────────────────────────

function ActivityContent({ storyId }: { storyId: string }) {
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
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 text-[0.6875rem] hover:bg-accent/30 transition-colors"
                    >
                      {expanded
                        ? <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                        : <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                      }
                      <span className="font-mono text-foreground/65 truncate">{run.agentName}</span>
                      <span className="text-muted-foreground shrink-0">{runTime}</span>
                      <span className="text-muted-foreground shrink-0">{formatDuration(run.durationMs)}</span>
                      <span className={`ml-auto text-[0.5625rem] font-mono shrink-0 ${isError ? 'text-red-500/70' : 'text-emerald-500/50'}`}>
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
              <Radio className="size-5 text-muted-foreground mb-3" />
              <p className="text-xs text-muted-foreground italic max-w-[220px]">
                No activity yet. Agents run automatically after each generation.
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
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <h4 className="text-[0.5625rem] text-muted-foreground uppercase tracking-[0.15em] font-medium">
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
          className="flex items-start gap-1.5 text-[0.625rem] py-0.5"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          <span className="text-muted-foreground mt-px">{depth === 0 ? '\u25CF' : '\u2514'}</span>
          <span className="font-mono text-foreground/70">{node.agentName}</span>
          <span className="text-muted-foreground">{formatDuration(node.durationMs)}</span>
          <span className={node.status === 'error' ? 'text-red-500/70' : 'text-emerald-500/50'}>
            {node.status}
          </span>
        </div>
        {node.error && (
          <p
            className="text-[0.5625rem] text-red-500/60 leading-tight"
            style={{ paddingLeft: `${depth * 12 + 20}px` }}
          >
            {node.error}
          </p>
        )}
        {node.output && <TraceNodeOutput output={node.output} depth={depth} />}
        {children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="border-t border-border/15 px-1 py-2 bg-muted/15">
      {run.input && <TraceDataSection label="Input" data={run.input} />}
      {run.output && <TraceDataSection label="Output" data={run.output} />}
      {roots.map((root) => renderNode(root, 0))}
      {run.error && (
        <p className="text-[0.5625rem] text-red-500/60 px-2 mt-1">{run.error}</p>
      )}
    </div>
  )
}

function TraceDataSection({ label, data }: { label: string; data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false)
  const entries = Object.entries(data)
  if (entries.length === 0) return null

  const previewParts: string[] = []
  for (const [key, value] of entries) {
    if (typeof value === 'string' && value.length <= 60) {
      previewParts.push(`${key}: ${value}`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      previewParts.push(`${key}: ${String(value)}`)
    }
    if (previewParts.length >= 3) break
  }
  const preview = previewParts.length > 0 ? previewParts.join(', ') : `${entries.length} fields`

  return (
    <div className="px-2 py-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[0.5625rem] text-muted-foreground hover:text-foreground/60 transition-colors"
      >
        {expanded ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
        <span className="font-medium">{label}</span>
        {!expanded && <span className="font-mono truncate max-w-[200px]">{preview}</span>}
      </button>
      {expanded && (
        <pre className="mt-1 text-[0.5625rem] text-muted-foreground leading-relaxed whitespace-pre-wrap break-all px-4 py-1 rounded-md border border-border/15 bg-muted/10">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

function TraceNodeOutput({ output, depth }: { output: Record<string, unknown>; depth: number }) {
  const [expanded, setExpanded] = useState(false)
  const indent = depth * 12 + 20

  const summary = typeof output.summary === 'string' ? output.summary : null
  const reasoning = typeof output.reasoning === 'string' ? output.reasoning : null
  const modelId = typeof output.modelId === 'string' ? output.modelId : null
  const durationMs = typeof output.durationMs === 'number' ? output.durationMs : null

  return (
    <div style={{ paddingLeft: `${indent}px` }} className="py-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[0.5625rem] text-muted-foreground hover:text-muted-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
        <span>Output</span>
        {modelId && (
          <Badge variant="outline" className="text-[0.5rem] h-3 px-1">{modelId}</Badge>
        )}
        {durationMs != null && (
          <span className="text-muted-foreground">{formatDuration(durationMs)}</span>
        )}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1.5">
          {reasoning && (
            <TraceOutputSection icon={<Brain className="size-3 text-purple-400/60" />} label="Reasoning">
              <p className="text-[0.5625rem] text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
                {reasoning}
              </p>
            </TraceOutputSection>
          )}
          {summary && (
            <div className="rounded-md border border-border/15 px-2 py-1.5">
              <p className="text-[0.625rem] text-foreground/60 leading-relaxed">{summary}</p>
            </div>
          )}
          {!summary && !reasoning && (
            <pre className="text-[0.5625rem] text-muted-foreground leading-relaxed whitespace-pre-wrap break-all px-2">
              {JSON.stringify(output, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function TraceOutputSection({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-md border border-border/15 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[0.625rem] hover:bg-accent/20 transition-colors"
      >
        {icon}
        <span className="text-muted-foreground">{label}</span>
      </button>
      {expanded && (
        <div className="border-t border-border/10 px-2 py-1.5">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Live Analysis Trace ────────────────────────────────────

type CollapsedTraceItem =
  | { kind: 'reasoning'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; toolName: string; args: Record<string, unknown> }
  | { kind: 'tool-result'; toolName: string; result: unknown }

function LiveAnalysisTrace({ storyId }: { storyId: string }) {
  const [events, setEvents] = useState<ChatEvent[]>([])
  const [connected, setConnected] = useState(false)
  const readerRef = useRef<ReadableStreamDefaultReader<ChatEvent> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function connect() {
      try {
        const stream = await api.librarian.getAnalysisStream(storyId)
        if (cancelled) return
        setConnected(true)
        const reader = stream.getReader()
        readerRef.current = reader

        while (true) {
          const { done, value } = await reader.read()
          if (done || cancelled) break
          setEvents((prev) => [...prev, value])
        }
      } catch {
        // Stream ended or error
      } finally {
        if (!cancelled) {
          setConnected(false)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      readerRef.current?.cancel().catch(() => {})
    }
  }, [storyId])

  const items = useMemo(() => {
    const collapsed: CollapsedTraceItem[] = []
    let reasoningBuf = ''
    let textBuf = ''

    for (const ev of events) {
      if (ev.type === 'reasoning') {
        if (textBuf) { collapsed.push({ kind: 'text', text: textBuf }); textBuf = '' }
        reasoningBuf += ev.text
      } else if (ev.type === 'text') {
        if (reasoningBuf) { collapsed.push({ kind: 'reasoning', text: reasoningBuf }); reasoningBuf = '' }
        textBuf += ev.text
      } else {
        if (reasoningBuf) { collapsed.push({ kind: 'reasoning', text: reasoningBuf }); reasoningBuf = '' }
        if (textBuf) { collapsed.push({ kind: 'text', text: textBuf }); textBuf = '' }
        if (ev.type === 'tool-call') {
          collapsed.push({ kind: 'tool-call', toolName: ev.toolName, args: ev.args })
        } else if (ev.type === 'tool-result') {
          collapsed.push({ kind: 'tool-result', toolName: ev.toolName, result: ev.result })
        }
      }
    }
    if (reasoningBuf) collapsed.push({ kind: 'reasoning', text: reasoningBuf })
    if (textBuf) collapsed.push({ kind: 'text', text: textBuf })
    return collapsed
  }, [events])

  if (!connected && events.length === 0) return null

  return (
    <div className="shrink-0 mx-4 mb-1">
      <div className="rounded-md border border-border/20 bg-muted/20 p-2 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="relative flex size-1.5">
            {connected && (
              <span className="absolute inset-0 rounded-full bg-blue-400 animate-ping" style={{ animationDuration: '2s' }} />
            )}
            <span className={`relative inline-flex size-1.5 rounded-full ${connected ? 'bg-blue-400' : 'bg-muted-foreground/30'}`} />
          </span>
          <span className="text-[0.5625rem] text-muted-foreground uppercase tracking-wider">Live Trace</span>
        </div>
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {items.map((item, i) => (
            <LiveTraceItem key={`${item.kind}-${i}`} item={item} />
          ))}
        </div>
      </div>
    </div>
  )
}

function LiveTraceItem({ item }: { item: CollapsedTraceItem }) {
  if (item.kind === 'reasoning') {
    return (
      <div className="flex items-start gap-1 px-1">
        <Brain className="size-2.5 text-purple-400/50 shrink-0 mt-0.5" />
        <p className="text-[0.5625rem] text-muted-foreground leading-snug truncate">{item.text.slice(0, 120)}{item.text.length > 120 ? '\u2026' : ''}</p>
      </div>
    )
  }
  if (item.kind === 'text') {
    return (
      <div className="px-1">
        <p className="text-[0.5625rem] text-foreground/40 leading-snug truncate">{item.text.slice(0, 120)}{item.text.length > 120 ? '\u2026' : ''}</p>
      </div>
    )
  }
  if (item.kind === 'tool-call') {
    return (
      <div className="flex items-center gap-1 px-1">
        <Wrench className="size-2.5 text-blue-400/50 shrink-0" />
        <Badge variant="outline" className="text-[0.5rem] h-3 px-1">{item.toolName}</Badge>
      </div>
    )
  }
  if (item.kind === 'tool-result') {
    return (
      <div className="flex items-center gap-1 px-1">
        <Check className="size-2 text-emerald-500/40" />
        <span className="text-[0.5rem] text-muted-foreground">{item.toolName}</span>
      </div>
    )
  }
  return null
}
