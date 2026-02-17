import { useState, useRef, useCallback, useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface BlockContentViewProps {
  messages: Array<{ role: string; content: string }>
  blocks?: Array<{ id: string; name: string; role: string }>
  className?: string
}

/** Parse compiled messages into per-block segments using [@block=id] markers */
function parseBlockSegments(messages: Array<{ role: string; content: string }>) {
  const segments: Array<{ id: string; role: string; content: string }> = []

  for (const msg of messages) {
    const parts = msg.content.split(/\[@block=([^\]]+)\]\n?/)
    for (let i = 1; i < parts.length; i += 2) {
      const id = parts[i]
      const content = (parts[i + 1] ?? '').replace(/\n{2,}$/, '')
      segments.push({ id, role: msg.role, content })
    }
  }

  return segments
}

export function BlockContentView({ messages, blocks, className }: BlockContentViewProps) {
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const segments = useMemo(() => parseBlockSegments(messages), [messages])

  // Build nav groups from explicit blocks list, or fall back to segments
  const navGroups = useMemo(() => {
    const source = blocks ?? segments.map((s) => ({ id: s.id, name: s.id, role: s.role }))
    const groups: Array<{ role: string; blocks: Array<{ id: string; name: string }> }> = []
    let currentRole = ''
    for (const block of source) {
      if (block.role !== currentRole) {
        currentRole = block.role
        groups.push({ role: block.role, blocks: [] })
      }
      groups[groups.length - 1].blocks.push({ id: block.id, name: block.name })
    }
    return groups
  }, [blocks, segments])

  const scrollToBlock = useCallback((blockId: string) => {
    setActiveBlockId(blockId)
    const el = contentRef.current?.querySelector(`[data-block-id="${blockId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  if (segments.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-16', className)}>
        <p className="text-xs text-muted-foreground/55 italic">No blocks in context</p>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-1 min-h-0', className)}>
      {/* Left nav */}
      <div className="w-[180px] shrink-0 border-r border-border/30 overflow-y-auto py-3 px-2">
        {navGroups.map((group) => (
          <div key={group.role} className="mb-3 last:mb-0">
            <div className="flex items-center gap-1.5 px-2 mb-1">
              <div className="size-1 rounded-full bg-muted-foreground/50" />
              <span className="text-[9px] text-muted-foreground/55 uppercase tracking-[0.15em] font-medium">
                {group.role}
              </span>
            </div>
            {group.blocks.map((block) => (
              <button
                key={block.id}
                className={cn(
                  'w-full text-left px-2 py-1 rounded-md text-[11px] truncate transition-colors duration-100',
                  activeBlockId === block.id
                    ? 'bg-accent/50 text-foreground font-medium'
                    : 'text-muted-foreground/60 hover:text-foreground/80 hover:bg-accent/25',
                )}
                onClick={() => scrollToBlock(block.id)}
                title={block.name}
              >
                {block.name}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Right content */}
      <ScrollArea className="flex-1 min-w-0">
        <div ref={contentRef} className="p-4 space-y-2">
          {segments.map((seg) => (
            <div
              key={seg.id}
              data-block-id={seg.id}
              className={cn(
                'rounded-lg border border-border/20 overflow-hidden transition-colors duration-200',
                activeBlockId === seg.id && 'border-border/40 bg-accent/10',
              )}
            >
              {/* Block header */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/10 border-b border-border/10">
                <span className="text-[10px] font-medium text-muted-foreground/50 truncate">
                  {seg.id}
                </span>
                <span className="text-[9px] text-muted-foreground/45 tabular-nums ml-auto shrink-0">
                  {seg.content.length.toLocaleString()} chars
                </span>
                <Badge
                  variant="outline"
                  className="text-[9px] h-3.5 px-1 font-normal border-transparent text-muted-foreground/50 bg-muted/30 shrink-0"
                >
                  {seg.role}
                </Badge>
              </div>

              {/* Block content */}
              <pre className="whitespace-pre-wrap text-[11px] font-mono text-muted-foreground/70 p-3 max-h-[300px] overflow-y-auto leading-relaxed">
                {seg.content}
              </pre>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
