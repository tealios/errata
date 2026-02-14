import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type GenerationLog, type GenerationLogSummary } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

interface DebugPanelProps {
  storyId: string
  /** If provided, show this specific log directly */
  logId?: string
  /** If provided, find the log associated with this fragment */
  fragmentId?: string
  onClose: () => void
}

export function DebugPanel({ storyId, logId, fragmentId, onClose }: DebugPanelProps) {
  const [selectedLogId, setSelectedLogId] = useState<string | null>(logId ?? null)
  const [activeTab, setActiveTab] = useState<'prompt' | 'tools' | 'output'>('prompt')
  const directLookup = !!(logId || fragmentId)

  // Always fetch logs list (for sidebar and for fragmentId lookup)
  const { data: logs } = useQuery({
    queryKey: ['generation-logs', storyId],
    queryFn: () => api.generation.listLogs(storyId),
  })

  // If fragmentId is provided, find the matching log from the list
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
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Debug</h2>
          <Badge variant="outline" className="text-[10px]">Generation Logs</Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Log list sidebar (always visible for browsing) */}
        {!directLookup && (
          <div className="w-56 border-r flex flex-col">
            <div className="p-2 border-b">
              <span className="text-xs font-medium text-muted-foreground">Recent Generations</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-1 p-2">
                {(!logs || logs.length === 0) && (
                  <p className="text-xs text-muted-foreground py-4 text-center">No logs yet</p>
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
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedLog ? (
            <>
              {/* Tabs */}
              <div className="flex gap-1 p-2 border-b">
                {(['prompt', 'tools', 'output'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`text-xs px-3 py-1.5 rounded-md capitalize ${
                      activeTab === tab
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab}
                    {tab === 'tools' && selectedLog.toolCalls.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-[9px] px-1">
                        {selectedLog.toolCalls.length}
                      </Badge>
                    )}
                  </button>
                ))}

                {/* Stats inline */}
                <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{selectedLog.model}</span>
                  <span>{selectedLog.durationMs}ms</span>
                  <span>{selectedLog.stepCount ?? 1} steps</span>
                  <span>{selectedLog.finishReason}</span>
                  {selectedLog.fragmentId && (
                    <Badge variant="outline" className="text-[9px]">{selectedLog.fragmentId}</Badge>
                  )}
                  {selectedLog.stepsExceeded && (
                    <Badge variant="destructive" className="text-[9px]">STEPS EXCEEDED</Badge>
                  )}
                </div>
              </div>

              {/* Steps exceeded warning */}
              {selectedLog.stepsExceeded && (
                <div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-b">
                  Generation hit the 10-step limit. The model may not have finished its tool calls.
                  Output may be incomplete or missing context.
                </div>
              )}

              {/* Tab content */}
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {activeTab === 'prompt' && <PromptTab log={selectedLog} />}
                  {activeTab === 'tools' && <ToolsTab log={selectedLog} />}
                  {activeTab === 'output' && <OutputTab log={selectedLog} />}
                </div>
              </ScrollArea>
            </>
          ) : logLoading ? (
            <div className="flex items-center justify-center flex-1">
              <p className="text-sm text-muted-foreground">Loading log...</p>
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1">
              <p className="text-sm text-muted-foreground">Select a generation log to inspect</p>
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
      className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent ${
        selected ? 'bg-accent' : ''
      }`}
    >
      <p className="truncate font-medium">{log.input}</p>
      <div className="flex items-center gap-1 mt-0.5 text-muted-foreground">
        <span>{new Date(log.createdAt).toLocaleString()}</span>
        {log.toolCallCount > 0 && (
          <Badge variant="secondary" className="text-[9px] px-1">{log.toolCallCount} tools</Badge>
        )}
        {log.stepsExceeded && (
          <Badge variant="destructive" className="text-[9px] px-1">exceeded</Badge>
        )}
      </div>
    </button>
  )
}

function PromptTab({ log }: { log: GenerationLog }) {
  return (
    <div className="space-y-4">
      {log.messages.map((msg, i) => (
        <div key={i}>
          <div className="flex items-center gap-2 mb-1">
            <Badge
              variant={msg.role === 'system' ? 'default' : 'secondary'}
              className="text-[10px]"
            >
              {msg.role}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {msg.content.length.toLocaleString()} chars
            </span>
          </div>
          <pre className="whitespace-pre-wrap text-xs font-mono bg-muted rounded-md p-3 max-h-[500px] overflow-auto">
            {msg.content}
          </pre>
        </div>
      ))}

      {/* Author input for context */}
      <div>
        <Badge variant="outline" className="text-[10px] mb-1">author input</Badge>
        <pre className="whitespace-pre-wrap text-xs font-mono bg-muted rounded-md p-3">
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
    if (next.has(idx)) {
      next.delete(idx)
    } else {
      next.add(idx)
    }
    setExpanded(next)
  }

  if (log.toolCalls.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No tool calls were made during this generation.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {log.toolCalls.map((tc, i) => (
        <div key={i} className="rounded-md border">
          <button
            onClick={() => toggle(i)}
            className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/50"
          >
            <span className="text-xs font-mono font-medium">{tc.toolName}</span>
            <Badge variant="outline" className="text-[9px]">
              {Object.keys(tc.args).length} args
            </Badge>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {expanded.has(i) ? 'collapse' : 'expand'}
            </span>
          </button>
          {expanded.has(i) && (
            <div className="px-3 pb-3 space-y-2">
              <Separator />
              <div>
                <span className="text-[10px] font-medium text-muted-foreground">Arguments</span>
                <pre className="whitespace-pre-wrap text-xs font-mono bg-muted rounded-md p-2 mt-1">
                  {JSON.stringify(tc.args, null, 2)}
                </pre>
              </div>
              <div>
                <span className="text-[10px] font-medium text-muted-foreground">Result</span>
                <pre className="whitespace-pre-wrap text-xs font-mono bg-muted rounded-md p-2 mt-1 max-h-[300px] overflow-auto">
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
        <Badge variant="outline" className="text-[10px]">generated text</Badge>
        <span className="text-[10px] text-muted-foreground">
          {log.generatedText.length.toLocaleString()} chars
        </span>
      </div>
      <pre className="whitespace-pre-wrap text-sm font-serif bg-muted rounded-md p-4 leading-relaxed">
        {log.generatedText}
      </pre>
    </div>
  )
}
