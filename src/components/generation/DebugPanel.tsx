import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type GenerationLog, type GenerationLogSummary } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X, ChevronDown, ChevronRight } from 'lucide-react'

interface DebugPanelProps {
  storyId: string
  logId?: string
  fragmentId?: string
  onClose: () => void
}

export function DebugPanel({ storyId, logId, fragmentId, onClose }: DebugPanelProps) {
  const [selectedLogId, setSelectedLogId] = useState<string | null>(logId ?? null)
  const [activeTab, setActiveTab] = useState<'prompt' | 'tools' | 'output'>('prompt')
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg">Debug</h2>
          <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">Generation Logs</span>
        </div>
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground/50" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Log list sidebar */}
        {!directLookup && (
          <div className="w-56 border-r border-border/50 flex flex-col">
            <div className="px-3 py-2.5 border-b border-border/50">
              <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">Recent</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-1.5 space-y-0.5">
                {(!logs || logs.length === 0) && (
                  <p className="text-xs text-muted-foreground/40 py-8 text-center italic">No logs yet</p>
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
                {(['prompt', 'tools', 'output'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`text-xs px-2.5 py-1 rounded-md capitalize transition-colors ${
                      activeTab === tab
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground/50 hover:text-muted-foreground'
                    }`}
                  >
                    {tab}
                    {tab === 'tools' && selectedLog.toolCalls.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-[9px] px-1 h-3.5">
                        {selectedLog.toolCalls.length}
                      </Badge>
                    )}
                  </button>
                ))}

                {/* Stats */}
                <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/40">
                  <span>{selectedLog.model}</span>
                  <span>{selectedLog.durationMs}ms</span>
                  <span>{selectedLog.stepCount ?? 1} steps</span>
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
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-6">
                  {activeTab === 'prompt' && <PromptTab log={selectedLog} />}
                  {activeTab === 'tools' && <ToolsTab log={selectedLog} />}
                  {activeTab === 'output' && <OutputTab log={selectedLog} />}
                </div>
              </ScrollArea>
            </>
          ) : logLoading ? (
            <div className="flex items-center justify-center flex-1">
              <p className="text-sm text-muted-foreground/50 italic">Loading log...</p>
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1">
              <p className="text-sm text-muted-foreground/40 italic">Select a generation log to inspect</p>
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
      className={`w-full text-left rounded-md px-2.5 py-2 text-xs transition-colors duration-100 hover:bg-accent/50 ${
        selected ? 'bg-accent' : ''
      }`}
    >
      <p className="truncate font-medium leading-tight">{log.input}</p>
      <div className="flex items-center gap-1.5 mt-1 text-muted-foreground/40">
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

function PromptTab({ log }: { log: GenerationLog }) {
  return (
    <div className="space-y-5">
      {log.messages.map((msg, i) => (
        <div key={i}>
          <div className="flex items-center gap-2 mb-1.5">
            <Badge
              variant={msg.role === 'system' ? 'default' : 'secondary'}
              className="text-[10px] h-4"
            >
              {msg.role === 'system' ? 'system prompt' : msg.role}
            </Badge>
            <span className="text-[10px] text-muted-foreground/40">
              {msg.content.length.toLocaleString()} chars
            </span>
          </div>
          <pre className={`whitespace-pre-wrap text-xs font-mono rounded-lg p-4 max-h-[500px] overflow-auto ${
            msg.role === 'system'
              ? 'bg-primary/5 border border-primary/20'
              : 'bg-card/50 border border-border/30'
          }`}>
            {msg.content}
          </pre>
        </div>
      ))}

      <div>
        <Badge variant="outline" className="text-[10px] h-4 mb-1.5">author input</Badge>
        <pre className="whitespace-pre-wrap text-xs font-mono bg-card/50 rounded-lg p-4 border border-border/30">
          {log.input}
        </pre>
      </div>
    </div>
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

  if (log.toolCalls.length === 0) {
    return (
      <p className="text-sm text-muted-foreground/40 text-center py-12 italic">
        No tool calls were made during this generation.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {log.toolCalls.map((tc, i) => (
        <div key={i} className="rounded-lg border border-border/30">
          <button
            onClick={() => toggle(i)}
            className="w-full text-left px-3.5 py-2.5 flex items-center gap-2 hover:bg-card/30 transition-colors rounded-lg"
          >
            {expanded.has(i) ? <ChevronDown className="size-3 text-muted-foreground/40" /> : <ChevronRight className="size-3 text-muted-foreground/40" />}
            <span className="text-xs font-mono font-medium">{tc.toolName}</span>
            <Badge variant="outline" className="text-[9px] h-3.5">
              {Object.keys(tc.args).length} args
            </Badge>
          </button>
          {expanded.has(i) && (
            <div className="px-3.5 pb-3.5 space-y-2.5">
              <div className="h-px bg-border/30" />
              <div>
                <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">Arguments</span>
                <pre className="whitespace-pre-wrap text-xs font-mono bg-card/50 rounded-md p-2.5 mt-1 border border-border/20">
                  {JSON.stringify(tc.args, null, 2)}
                </pre>
              </div>
              <div>
                <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">Result</span>
                <pre className="whitespace-pre-wrap text-xs font-mono bg-card/50 rounded-md p-2.5 mt-1 max-h-[300px] overflow-auto border border-border/20">
                  {JSON.stringify(tc.result, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function OutputTab({ log }: { log: GenerationLog }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Generated text</span>
        <span className="text-[10px] text-muted-foreground/30">
          {log.generatedText.length.toLocaleString()} chars
        </span>
      </div>
      <div className="prose-content whitespace-pre-wrap bg-card/30 rounded-lg p-6 border border-border/20">
        {log.generatedText}
      </div>
    </div>
  )
}
