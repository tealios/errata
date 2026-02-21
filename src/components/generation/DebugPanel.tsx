import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type GenerationLog, type GenerationLogSummary } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StreamMarkdown } from '@/components/ui/stream-markdown'
import { BlockContentView } from '@/components/blocks/BlockContentView'
import { X, ChevronDown, ChevronRight, Copy, Check, Brain, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DebugPanelProps {
  storyId: string
  logId?: string
  fragmentId?: string
  onClose: () => void
}

export function DebugPanel({ storyId, logId, fragmentId, onClose }: DebugPanelProps) {
  const [selectedLogId, setSelectedLogId] = useState<string | null>(logId ?? null)
  const [activeTab, setActiveTab] = useState<'prompt' | 'prewriter-prompt' | 'tools' | 'output'>('prompt')
  const directLookup = !!(logId || fragmentId)

  const { data: logs } = useQuery({
    queryKey: ['generation-logs', storyId],
    queryFn: () => api.generation.listLogs(storyId),
  })

  if (fragmentId && !selectedLogId && logs) {
    const match = logs.find((l) => l.fragmentId === fragmentId)
    if (match) {
      setSelectedLogId(match.id)
    }
  }

  const { data: selectedLog, isLoading: logLoading } = useQuery({
    queryKey: ['generation-log', storyId, selectedLogId],
    queryFn: () => api.generation.getLog(storyId, selectedLogId!),
    enabled: !!selectedLogId,
  })

  return (
    <div className="flex flex-col h-full" data-component-id="debug-panel-root">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50" data-component-id="debug-panel-header">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg">Debug</h2>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Generation Logs</span>
        </div>
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={onClose} data-component-id="debug-close">
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Log list sidebar */}
        {!directLookup && (
          <div className="w-56 border-r border-border/50 flex flex-col" data-component-id="debug-log-list">
            <div className="px-3 py-2.5 border-b border-border/50">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Recent</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-1.5 space-y-0.5">
                {(!logs || logs.length === 0) && (
                  <p className="text-xs text-muted-foreground py-8 text-center italic">No logs yet</p>
                )}
                {logs?.map((log) => (
                  <LogListItem
                    key={log.id}
                    log={log}
                    selected={selectedLogId === log.id}
                    onClick={() => setSelectedLogId(log.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Log detail */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {selectedLog ? (
            <>
              {/* Tabs */}
              <div className="flex items-center gap-1 px-4 py-2.5 border-b border-border/50">
                {([
                  ...(selectedLog.prewriterMessages?.length ? ['prewriter-prompt'] as const : []),
                  'prompt' as const,
                  'tools' as const,
                  'output' as const,
                ]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    data-component-id={`debug-tab-${tab}`}
                    className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                      activeTab === tab
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:text-muted-foreground'
                    }`}
                  >
                    {tab === 'prewriter-prompt' ? 'prewriter prompt' : tab}
                    {tab === 'tools' && selectedLog.toolCalls.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-[9px] px-1 h-3.5">
                        {selectedLog.toolCalls.length}
                      </Badge>
                    )}
                  </button>
                ))}

                {/* Stats */}
                <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
                  {selectedLog.prewriterModel && (
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal border-primary/20 text-primary/60">
                      prewriter
                    </Badge>
                  )}
                  <span>{selectedLog.model}</span>
                  <span>{selectedLog.durationMs}ms</span>
                  <span>{selectedLog.stepCount ?? 1} steps</span>
                  {selectedLog.totalUsage && (
                    <span title={`In: ${selectedLog.totalUsage.inputTokens.toLocaleString()} / Out: ${selectedLog.totalUsage.outputTokens.toLocaleString()}`}>
                      {(selectedLog.totalUsage.inputTokens + selectedLog.totalUsage.outputTokens).toLocaleString()} tok
                    </span>
                  )}
                  <span>{selectedLog.finishReason}</span>
                  {selectedLog.fragmentId && (
                    <span className="font-mono">{selectedLog.fragmentId}</span>
                  )}
                  {selectedLog.stepsExceeded && (
                    <Badge variant="destructive" className="text-[9px] h-3.5">EXCEEDED</Badge>
                  )}
                </div>
              </div>

              {selectedLog.stepsExceeded && (
                <div className="px-6 py-2 text-xs text-destructive bg-destructive/5 border-b border-border/50">
                  Generation hit the 10-step limit. Output may be incomplete.
                </div>
              )}

              {/* Tab content */}
              {activeTab === 'prompt' || activeTab === 'prewriter-prompt' ? (
                <BlockContentView messages={activeTab === 'prewriter-prompt' ? (selectedLog.prewriterMessages ?? []) : selectedLog.messages} />
              ) : (
                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-4 space-y-2">
                    {activeTab === 'tools' && <ToolsTab log={selectedLog} />}
                    {activeTab === 'output' && <OutputTab log={selectedLog} />}
                  </div>
                </ScrollArea>
              )}
            </>
          ) : logLoading ? (
            <div className="flex items-center justify-center flex-1">
              <p className="text-sm text-muted-foreground italic">Loading log...</p>
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1">
              <p className="text-sm text-muted-foreground italic">Select a generation log to inspect</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LogListItem({
  log,
  selected,
  onClick,
}: {
  log: GenerationLogSummary
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      data-component-id={`debug-log-${log.id}-item`}
      className={`w-full text-left rounded-md px-2.5 py-2 text-xs transition-colors duration-100 hover:bg-accent/50 ${
        selected ? 'bg-accent' : ''
      }`}
    >
      <p className="truncate font-medium leading-tight">{log.input}</p>
      <div className="flex items-center gap-1.5 mt-1 text-muted-foreground">
        <span>{new Date(log.createdAt).toLocaleString()}</span>
        {log.toolCallCount > 0 && (
          <Badge variant="secondary" className="text-[9px] h-3.5 px-1">{log.toolCallCount} tools</Badge>
        )}
        {log.stepsExceeded && (
          <Badge variant="destructive" className="text-[9px] h-3.5 px-1">exceeded</Badge>
        )}
      </div>
    </button>
  )
}

/** Classify tool as read or write */
function getToolKind(name: string): 'read' | 'write' {
  const lower = name.toLowerCase()
  if (
    lower.startsWith('create') ||
    lower.startsWith('update') ||
    lower.startsWith('edit') ||
    lower.startsWith('delete') ||
    lower.startsWith('set')
  )
    return 'write'
  return 'read'
}

/** Extract a one-line summary from a tool result */
function summarizeResult(result: unknown): string {
  if (result == null) return 'null'
  if (typeof result === 'string') return result.length > 80 ? result.slice(0, 80) + '...' : result

  const r = result as Record<string, unknown>

  // Error case
  if (r.error) return `error: ${r.error}`

  // Success case
  if (r.ok === true) {
    const parts: string[] = []
    if (r.id) parts.push(`id=${r.id}`)
    if (typeof r.count === 'number') parts.push(`${r.count} edited`)
    if (Array.isArray(r.editedFragments)) parts.push(r.editedFragments.join(', '))
    return parts.length ? parts.join(' ') : 'ok'
  }

  // Fragment result (has name)
  if (r.name && r.type) return `${r.name} (${r.type})`
  if (r.name) return String(r.name)

  // List result
  if (Array.isArray(r.fragments)) return `${r.fragments.length} fragment${r.fragments.length === 1 ? '' : 's'}`
  if (Array.isArray(r.matches)) return `${r.matches.length} match${r.matches.length === 1 ? '' : 'es'} of ${r.total ?? '?'}`
  if (Array.isArray(r.types)) return `${r.types.length} type${r.types.length === 1 ? '' : 's'}`

  // Array at top level
  if (Array.isArray(result)) return `[${result.length} items]`

  // Fallback: count keys
  const keys = Object.keys(r)
  return keys.length <= 3 ? keys.join(', ') : `{${keys.length} fields}`
}

/** Format arg values for inline display */
function formatArgValue(value: unknown): string {
  if (typeof value === 'string') return value.length > 40 ? value.slice(0, 40) + '...' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value == null) return 'null'
  return JSON.stringify(value).slice(0, 40)
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    },
    [text],
  )

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center gap-1 text-[9px] text-muted-foreground hover:text-muted-foreground transition-colors',
        className,
      )}
      title="Copy to clipboard"
    >
      {copied ? <Check className="size-2.5" /> : <Copy className="size-2.5" />}
      {copied ? 'copied' : 'copy'}
    </button>
  )
}

function ToolsTab({ log }: { log: GenerationLog }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const toggle = (idx: number) => {
    const next = new Set(expanded)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setExpanded(next)
  }

  const allExpanded = expanded.size === log.toolCalls.length && log.toolCalls.length > 0
  const toggleAll = () => {
    if (allExpanded) {
      setExpanded(new Set())
    } else {
      setExpanded(new Set(log.toolCalls.map((_, i) => i)))
    }
  }

  if (log.toolCalls.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-16 italic">
        No tool calls were made during this generation.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {/* Summary bar */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] text-muted-foreground">
          {log.toolCalls.length} call{log.toolCalls.length === 1 ? '' : 's'}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {log.toolCalls.filter((tc) => getToolKind(tc.toolName) === 'write').length} writes
        </span>
        <button
          onClick={toggleAll}
          className="ml-auto text-[10px] text-muted-foreground hover:text-muted-foreground transition-colors"
        >
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {log.toolCalls.map((tc, i) => {
        const argsStr = JSON.stringify(tc.args, null, 2)
        const resultStr = JSON.stringify(tc.result, null, 2)
        const isOpen = expanded.has(i)
        const kind = getToolKind(tc.toolName)
        const argEntries = Object.entries(tc.args as Record<string, unknown>)
        const summary = summarizeResult(tc.result)
        const isError = typeof tc.result === 'object' && tc.result !== null && 'error' in (tc.result as Record<string, unknown>)

        return (
          <div
            key={`${tc.toolName}-${i}`}
            className={cn(
              'rounded-lg border overflow-hidden transition-colors duration-200',
              isError ? 'border-destructive/20' : 'border-border/20',
            )}
          >
            {/* Tool header */}
            <button
              onClick={() => toggle(i)}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 bg-muted/10 border-b border-border/10 hover:bg-muted/20 transition-colors"
            >
              {/* Step number */}
              <span className="text-[9px] tabular-nums text-muted-foreground w-3 text-right shrink-0">
                {i + 1}
              </span>

              {isOpen ? (
                <ChevronDown className="size-3 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="size-3 text-muted-foreground shrink-0" />
              )}

              {/* Tool name */}
              <span className="text-[10px] font-mono font-medium text-foreground/70 shrink-0">
                {tc.toolName}
              </span>

              {/* Inline arg tokens */}
              <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                {argEntries.slice(0, 3).map(([key, val]) => (
                  <span
                    key={key}
                    className="text-[9px] font-mono text-muted-foreground bg-muted/20 rounded px-1 py-px truncate max-w-[140px] shrink-0"
                  >
                    <span className="text-muted-foreground">{key}=</span>
                    {formatArgValue(val)}
                  </span>
                ))}
                {argEntries.length > 3 && (
                  <span className="text-[9px] text-muted-foreground">+{argEntries.length - 3}</span>
                )}
              </div>

              {/* Kind badge */}
              <Badge
                variant="outline"
                className={cn(
                  'text-[9px] h-3.5 px-1 font-normal border-transparent shrink-0 ml-auto',
                  kind === 'write'
                    ? 'text-amber-500/70 bg-amber-500/8'
                    : 'text-muted-foreground bg-muted/30',
                )}
              >
                {kind}
              </Badge>
            </button>

            {/* Collapsed: result summary */}
            {!isOpen && (
              <div className="px-3 py-1.5 flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground shrink-0">
                  &rarr;
                </span>
                <span
                  className={cn(
                    'text-[11px] font-mono truncate',
                    isError ? 'text-destructive/70' : 'text-muted-foreground',
                  )}
                >
                  {summary}
                </span>
                <span className="text-[9px] text-muted-foreground tabular-nums ml-auto shrink-0">
                  {resultStr.length.toLocaleString()} ch
                </span>
              </div>
            )}

            {/* Expanded content */}
            {isOpen && (
              <div className="divide-y divide-border/10">
                {/* Arguments */}
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium">
                      Arguments
                    </span>
                    <CopyButton text={argsStr} className="ml-auto" />
                  </div>
                  {argEntries.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground italic">none</span>
                  ) : (
                    <div className="space-y-px">
                      {argEntries.map(([key, val]) => {
                        const valStr = typeof val === 'string' ? val : JSON.stringify(val)
                        const isLong = valStr.length > 80
                        return (
                          <div key={key} className="flex gap-2 text-[11px] font-mono leading-relaxed">
                            <span className="text-muted-foreground shrink-0 select-none w-[100px] text-right truncate" title={key}>
                              {key}
                            </span>
                            <span className="text-muted-foreground break-all">
                              {isLong ? (
                                <span className="whitespace-pre-wrap">{valStr}</span>
                              ) : (
                                valStr
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Result */}
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium">
                      Result
                    </span>
                    <span className="text-[9px] text-muted-foreground tabular-nums">
                      {resultStr.length.toLocaleString()} chars
                    </span>
                    <CopyButton text={resultStr} className="ml-auto" />
                  </div>
                  <pre className="whitespace-pre-wrap text-[11px] font-mono text-muted-foreground max-h-[300px] overflow-y-auto leading-relaxed">
                    {resultStr}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OutputTab({ log }: { log: GenerationLog }) {
  const [prewriterExpanded, setPrewriterExpanded] = useState(false)
  const [prewriterReasoningExpanded, setPrewriterReasoningExpanded] = useState(false)
  const [reasoningExpanded, setReasoningExpanded] = useState(false)

  return (
    <div className="space-y-2">
      {log.prewriterReasoning && (
        <div className="rounded-lg border border-primary/15 overflow-hidden">
          <button
            onClick={() => setPrewriterReasoningExpanded(!prewriterReasoningExpanded)}
            className="w-full flex items-center gap-2 px-3 py-1.5 bg-primary/[0.03] border-b border-primary/10 hover:bg-primary/[0.06] transition-colors"
          >
            {prewriterReasoningExpanded ? <ChevronDown className="size-3 text-primary/50" /> : <ChevronRight className="size-3 text-primary/50" />}
            <Brain className="size-3 text-primary/50" />
            <span className="text-[10px] font-medium text-primary/70">
              Prewriter Reasoning
            </span>
            <span className="text-[9px] text-muted-foreground tabular-nums ml-auto shrink-0">
              {log.prewriterReasoning.length.toLocaleString()} chars
            </span>
          </button>
          {prewriterReasoningExpanded && (
            <div className="p-3 max-h-[300px] overflow-y-auto">
              <pre className="whitespace-pre-wrap text-[11px] font-mono text-muted-foreground italic leading-relaxed">
                {log.prewriterReasoning}
              </pre>
            </div>
          )}
        </div>
      )}

      {log.prewriterBrief && (
        <div className="rounded-lg border border-primary/15 overflow-hidden">
          <button
            onClick={() => setPrewriterExpanded(!prewriterExpanded)}
            className="w-full flex items-center gap-2 px-3 py-1.5 bg-primary/[0.03] border-b border-primary/10 hover:bg-primary/[0.06] transition-colors"
          >
            {prewriterExpanded ? <ChevronDown className="size-3 text-primary/50" /> : <ChevronRight className="size-3 text-primary/50" />}
            <FileText className="size-3 text-primary/50" />
            <span className="text-[10px] font-medium text-primary/70">
              Writing Brief
            </span>
            {log.prewriterModel && (
              <span className="text-[9px] text-muted-foreground font-mono">
                {log.prewriterModel}
              </span>
            )}
            <span className="text-[9px] text-muted-foreground tabular-nums ml-auto shrink-0 flex items-center gap-2">
              {log.prewriterDurationMs != null && (
                <span>{log.prewriterDurationMs.toLocaleString()}ms</span>
              )}
              {log.prewriterUsage && (
                <span title={`In: ${log.prewriterUsage.inputTokens.toLocaleString()} / Out: ${log.prewriterUsage.outputTokens.toLocaleString()}`}>
                  {(log.prewriterUsage.inputTokens + log.prewriterUsage.outputTokens).toLocaleString()} tok
                </span>
              )}
              <span>{log.prewriterBrief.length.toLocaleString()} chars</span>
            </span>
          </button>
          {prewriterExpanded && (
            <div className="p-3 max-h-[400px] overflow-y-auto">
              <div className="flex justify-end mb-1.5">
                <CopyButton text={log.prewriterBrief} />
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed prose prose-sm prose-muted max-w-none [&_p]:text-[11px] [&_p]:text-muted-foreground [&_p]:leading-relaxed">
                <StreamMarkdown content={log.prewriterBrief} />
              </div>
            </div>
          )}
        </div>
      )}

      {log.reasoning && (
        <div className="rounded-lg border border-border/20 overflow-hidden">
          <button
            onClick={() => setReasoningExpanded(!reasoningExpanded)}
            className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/10 border-b border-border/10 hover:bg-muted/20 transition-colors"
          >
            {reasoningExpanded ? <ChevronDown className="size-3 text-muted-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" />}
            <Brain className="size-3 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground">
              Reasoning
            </span>
            <span className="text-[9px] text-muted-foreground tabular-nums ml-auto shrink-0">
              {log.reasoning.length.toLocaleString()} chars
            </span>
          </button>
          {reasoningExpanded && (
            <div className="p-3 max-h-[300px] overflow-y-auto">
              <pre className="whitespace-pre-wrap text-[11px] font-mono text-muted-foreground italic leading-relaxed">
                {log.reasoning}
              </pre>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border/20 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/10 border-b border-border/10">
          <span className="text-[10px] font-medium text-muted-foreground truncate">
            Generated text
          </span>
          <span className="text-[9px] text-muted-foreground tabular-nums ml-auto shrink-0">
            {log.generatedText.length.toLocaleString()} chars
          </span>
        </div>

        {/* Content */}
        <div className="p-3 max-h-[500px] overflow-y-auto">
          <div className="text-[11px] text-muted-foreground leading-relaxed prose prose-sm prose-muted max-w-none [&_p]:text-[11px] [&_p]:text-muted-foreground [&_p]:leading-relaxed">
            <StreamMarkdown content={log.generatedText} />
          </div>
        </div>
      </div>
    </div>
  )
}
