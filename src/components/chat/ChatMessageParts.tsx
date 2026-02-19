import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight, Brain, Loader2, Wrench } from 'lucide-react'
import { StreamMarkdown } from '@/components/ui/stream-markdown'

export interface ToolCallInfo {
  id: string
  toolName: string
  args: Record<string, unknown>
  result?: unknown
}

export interface AssistantMessage {
  role: 'assistant'
  content: string
  reasoning?: string
  toolCalls?: ToolCallInfo[]
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | AssistantMessage

export function ToolCallCard({ tc, defaultExpanded = false }: { tc: ToolCallInfo; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const args = tc.args ?? {}
  const argSummary = Object.entries(args)
    .filter(([, v]) => typeof v === 'string' && (v as string).length < 80)
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
    .join(', ')

  const hasResult = tc.result !== undefined

  return (
    <div className="my-1.5 rounded border border-border/40 bg-muted/20 text-[10px]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-muted/30 transition-colors"
      >
        {expanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <Wrench className="size-3 shrink-0 text-muted-foreground/60" />
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-mono">
          {tc.toolName}
        </Badge>
        {argSummary && (
          <span className="text-muted-foreground/50 truncate">{argSummary}</span>
        )}
        {hasResult && (
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 ml-auto shrink-0">
            done
          </Badge>
        )}
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-1.5 border-t border-border/20">
          <div>
            <div className="text-muted-foreground/50 mt-1.5 mb-0.5">Arguments</div>
            <pre className="bg-muted/30 rounded px-1.5 py-1 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          {hasResult && (
            <div>
              <div className="text-muted-foreground/50 mb-0.5">Result</div>
              <pre className="bg-muted/30 rounded px-1.5 py-1 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(tc.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ReasoningSection({ reasoning, streaming }: { reasoning: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <Brain className="size-3" />
        <span className="italic">
          {streaming ? 'Thinking...' : 'Reasoning'}
        </span>
        {streaming && <Loader2 className="size-3 animate-spin" />}
      </button>
      {expanded && (
        <div className="mt-1 pl-5 text-[10px] text-muted-foreground/40 italic whitespace-pre-wrap leading-relaxed">
          {reasoning}
        </div>
      )}
    </div>
  )
}

export function AssistantMessageView({ msg, streaming }: { msg: AssistantMessage; streaming: boolean }) {
  return (
    <div className="break-words">
      {msg.reasoning && (
        <ReasoningSection reasoning={msg.reasoning} streaming={streaming && !msg.content} />
      )}
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div>
          {msg.toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} tc={tc} />
          ))}
        </div>
      )}
      {msg.content && (
        <StreamMarkdown
          content={msg.content}
          streaming={streaming}
        />
      )}
      {streaming && !msg.content && !msg.reasoning && (
        <span className="inline-block w-0.5 h-[1em] bg-primary/60 animate-pulse align-text-bottom" />
      )}
    </div>
  )
}
