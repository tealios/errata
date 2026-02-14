import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ProseActionInput } from '@/components/prose/ProseActionInput'
import { VariationSwitcher } from '@/components/prose/VariationSwitcher'
import { RefreshCw, Sparkles, Undo2, Loader2, Send } from 'lucide-react'

interface ProseChainViewProps {
  storyId: string
  fragments: Fragment[]
  onSelectFragment: (fragment: Fragment) => void
  onDebugLog?: (logId: string) => void
}

export function ProseChainView({
  storyId,
  fragments,
  onSelectFragment,
  onDebugLog,
}: ProseChainViewProps) {
  // State for streaming generation
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamedText, setStreamedText] = useState('')
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Fetch prose chain to get active fragment info
  const { data: proseChain } = useQuery({
    queryKey: ['proseChain', storyId],
    queryFn: () => api.proseChain.get(storyId),
  })

  // Get active fragment IDs from the chain (source of truth)
  const activeFragmentIds = proseChain?.entries.map(entry => entry.active) ?? []

  // Filter fragments to only show active ones from the chain, in chain order
  const activeFragments = activeFragmentIds
    .map(id => fragments.find(f => f.id === id))
    .filter(Boolean) as Fragment[]

  // If no chain exists yet, fall back to showing all prose fragments
  const displayFragments = activeFragments.length > 0 ? activeFragments : fragments

  // Sort by order, then createdAt
  const sorted = [...displayFragments].sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
  )

  // Map fragments to their section index in the chain
  const getSectionIndex = (fragmentId: string): number => {
    if (!proseChain) return -1
    return proseChain.entries.findIndex(entry =>
      entry.proseFragments.some(f => f.id === fragmentId)
    )
  }

  // Get chain entry for a fragment
  const getChainEntry = (fragmentId: string) => {
    if (!proseChain) return null
    return proseChain.entries.find(entry =>
      entry.proseFragments.some(f => f.id === fragmentId)
    ) || null
  }

  // Scroll to bottom when streaming new content
  useEffect(() => {
    if (streamedText && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [streamedText])

  // Clear streamed text once fragments update (new prose was saved)
  useEffect(() => {
    if (!isGenerating && streamedText) {
      // Check if the last fragment's content matches our streamed text
      // or if a new fragment was added while we were generating
      const lastFragment = sorted[sorted.length - 1]
      if (lastFragment && (lastFragment.content === streamedText || lastFragment.meta?.generatedFrom)) {
        // Give a small delay so the transition is smooth
        const timeout = setTimeout(() => {
          setStreamedText('')
        }, 100)
        return () => clearTimeout(timeout)
      }
    }
  }, [sorted, isGenerating, streamedText])

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
      <div className="max-w-[38rem] mx-auto py-12 px-8">
        {sorted.length > 0 ? (
          sorted.map((fragment, idx) => (
            <ProseBlock
              key={fragment.id}
              storyId={storyId}
              fragment={fragment}
              sectionIndex={getSectionIndex(fragment.id)}
              chainEntry={getChainEntry(fragment.id)}
              isLast={idx === sorted.length - 1 && !isGenerating}
              isFirst={idx === 0}
              onSelect={() => onSelectFragment(fragment)}
              onDebugLog={onDebugLog}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="font-display text-xl italic text-muted-foreground/50 mb-3">
              The page awaits.
            </p>
            <p className="text-sm text-muted-foreground/70">
              Write or generate your first passage below.
            </p>
          </div>
        )}

        {/* Streaming text displayed inline as part of the prose chain */}
        {(isGenerating || streamedText) && (
          <div className="relative mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Match prose block styling - no border, minimal background */}
            <div className="rounded-lg p-4 -mx-4 bg-card/30">
              <div className="prose-content whitespace-pre-wrap">
                {streamedText}
                {isGenerating && (
                  <span className="inline-block w-0.5 h-[1.1em] bg-primary/60 animate-pulse ml-px align-text-bottom" />
                )}
              </div>
              
              {/* Minimal generating indicator matching prose metadata bar style */}
              {isGenerating && (
                <div className="flex items-center gap-2 mt-3 opacity-60">
                  <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground/50">
                    generating...
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <InlineGenerationInput 
          storyId={storyId} 
          onDebugLog={onDebugLog}
          isGenerating={isGenerating}
          streamedText={streamedText}
          onGenerationStart={() => {
            setIsGenerating(true)
            setStreamedText('')
          }}
          onGenerationStream={(text) => setStreamedText(text)}
          onGenerationComplete={() => {
            setIsGenerating(false)
            // Note: streamedText is NOT cleared here - it will be cleared after
            // the fragments query refreshes and the new fragment appears
          }}
          onGenerationError={() => {
            setIsGenerating(false)
          }}
        />
      </div>
    </ScrollArea>
  )
}

interface InlineGenerationInputProps {
  storyId: string
  onDebugLog?: (logId: string) => void
  isGenerating: boolean
  streamedText: string
  onGenerationStart: () => void
  onGenerationStream: (text: string) => void
  onGenerationComplete: () => void
  onGenerationError: () => void
}

function InlineGenerationInput({
  storyId,
  onDebugLog,
  isGenerating,
  onGenerationStart,
  onGenerationStream,
  onGenerationComplete,
  onGenerationError,
}: InlineGenerationInputProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    if (!input.trim() || isGenerating) return

    onGenerationStart()
    setError(null)

    try {
      const stream = await api.generation.generateAndSave(storyId, input)

      const reader = stream.getReader()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += value
        onGenerationStream(accumulated)
      }

      // Invalidate queries to refresh the prose view
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      
      // Clear input after successful generation
      setInput('')
      onGenerationComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
      onGenerationError()
    }
  }

  const handleStop = () => {
    // Note: Currently the stream doesn't support aborting mid-generation
    // The stop button will just hide the UI
    onGenerationError()
  }

  return (
    <div className="mt-8 pt-6 border-t border-border/30">
      {/* Error */}
      {error && (
        <div className="text-sm text-destructive mb-3">
          {error}
        </div>
      )}

      {/* Input area */}
      <div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What happens next..."
          className="min-h-[56px] max-h-[160px] resize-none text-sm bg-transparent border-border/40 focus:border-primary/30 placeholder:text-muted-foreground/40 placeholder:italic"
          disabled={isGenerating}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              handleGenerate()
            }
          }}
        />
        <div className="flex items-center justify-between mt-2.5">
          <div className="flex gap-1.5">
            {isGenerating ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleStop}
              >
                <span className="size-2 bg-destructive rounded-sm" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleGenerate}
                disabled={!input.trim()}
              >
                <Send className="size-3" />
                Generate
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {onDebugLog && (
              <button
                onClick={() => onDebugLog('')}
                className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              >
                Debug
              </button>
            )}
            <span className="text-[10px] text-muted-foreground/40">
              Ctrl+Enter to generate
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProseBlock({
  storyId,
  fragment,
  sectionIndex,
  chainEntry,
  isLast,
  isFirst,
  onSelect,
  onDebugLog,
}: {
  storyId: string
  fragment: Fragment
  sectionIndex: number
  chainEntry: import('@/lib/api').ProseChainEntry | null
  isLast: boolean
  isFirst?: boolean
  onSelect: () => void
  onDebugLog?: (logId: string) => void
}) {
  // isFirst is part of the interface for future use
  void isFirst
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(fragment.content)
  const [actionMode, setActionMode] = useState<'regenerate' | 'refine' | null>(null)
  const [showUndo, setShowUndo] = useState(false)
  const [isStreamingAction, setIsStreamingAction] = useState(false)
  const [streamedActionText, setStreamedActionText] = useState('')
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  const updateMutation = useMutation({
    mutationFn: (content: string) =>
      api.fragments.update(storyId, fragment.id, {
        name: fragment.name,
        description: fragment.description,
        content,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      setEditing(false)
    },
  })

  const revertMutation = useMutation({
    mutationFn: () => api.fragments.revert(storyId, fragment.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      setShowUndo(false)
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    },
  })

  const handleSave = () => {
    if (editContent !== fragment.content) {
      updateMutation.mutate(editContent)
    } else {
      setEditing(false)
    }
  }

  const handleActionComplete = () => {
    setActionMode(null)
    setIsStreamingAction(false)
    setStreamedActionText('')
    setShowUndo(true)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setShowUndo(false), 10000)
  }

  if (editing) {
    return (
      <div className="mb-6">
        <div className="rounded-lg border border-primary/20 bg-card/30 p-5">
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="min-h-[160px] resize-none prose-content border-0 p-0 focus-visible:ring-0 bg-transparent"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditContent(fragment.content)
                setEditing(false)
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                handleSave()
              }
            }}
          />
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
            <span className="text-xs text-muted-foreground/60">
              Esc to cancel · Ctrl+Enter to save
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  setEditContent(fragment.content)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-xs"
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group relative mb-6">
      <button
        onClick={() => {
          if (isLast) {
            setEditContent(fragment.content)
            setEditing(true)
          } else {
            onSelect()
          }
        }}
        className="text-left w-full rounded-lg p-4 -mx-4 transition-colors duration-150 hover:bg-card/40"
      >
        <div className="prose-content whitespace-pre-wrap">
          {(isStreamingAction || streamedActionText)
            ? streamedActionText || ''
            : fragment.content
          }
          {isStreamingAction && (
            <span className="inline-block w-0.5 h-[1.1em] bg-primary/60 animate-pulse ml-px align-text-bottom" />
          )}
        </div>

        {/* Metadata bar — visible on hover */}
        <div className="flex items-center gap-2 mt-3 pt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <span className="text-[10px] font-mono text-muted-foreground/50">
            {fragment.id}
          </span>
          <span className="text-[10px] text-muted-foreground/40">
            {fragment.description}
          </span>
          {!!fragment.meta?.generatedFrom && (
            <Badge
              variant="secondary"
              className="text-[10px] h-4 px-1.5 cursor-pointer hover:bg-primary/15 hover:text-primary transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                onDebugLog?.(fragment.id)
              }}
            >
              AI
            </Badge>
          )}
          {/* Variation switcher - shows when multiple variations exist */}
          {chainEntry && sectionIndex >= 0 && (
            <VariationSwitcher
              storyId={storyId}
              sectionIndex={sectionIndex}
              entry={chainEntry}
            />
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-6 text-muted-foreground/50 hover:text-foreground"
              title="Regenerate"
              onClick={(e) => {
                e.stopPropagation()
                setActionMode('regenerate')
              }}
            >
              <RefreshCw className="size-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-6 text-muted-foreground/50 hover:text-foreground"
              title="Refine"
              onClick={(e) => {
                e.stopPropagation()
                setActionMode('refine')
              }}
            >
              <Sparkles className="size-3" />
            </Button>
            {isLast && (
              <span className="text-[10px] text-muted-foreground/40 ml-1">
                click to edit
              </span>
            )}
          </div>
        </div>
      </button>

      {showUndo && (
        <div className="flex items-center gap-2 mt-1 px-4">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs gap-1"
            onClick={() => revertMutation.mutate()}
            disabled={revertMutation.isPending}
          >
            <Undo2 className="size-3" />
            {revertMutation.isPending ? 'Reverting...' : 'Undo'}
          </Button>
        </div>
      )}

      {(actionMode || isStreamingAction || streamedActionText) && (
        <ProseActionInput
          storyId={storyId}
          fragmentId={fragment.id}
          mode={actionMode || 'regenerate'}
          onComplete={handleActionComplete}
          onCancel={() => {
            setActionMode(null)
            setIsStreamingAction(false)
            setStreamedActionText('')
          }}
          onStreamStart={() => {
            setIsStreamingAction(true)
            setStreamedActionText('')
          }}
          onStream={(text) => setStreamedActionText(text)}
        />
      )}

      {/* Subtle separator between blocks */}
      {!isLast && (
        <div className="h-px bg-border/30 mx-4 mt-2" />
      )}
    </div>
  )
}
