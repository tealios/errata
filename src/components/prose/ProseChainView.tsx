import { useState, useEffect, useRef, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ProseActionInput } from '@/components/prose/ProseActionInput'
import { VariationSwitcher } from '@/components/prose/VariationSwitcher'
import { RefreshCw, Sparkles, Undo2, Loader2, PenLine, Bug, ChevronLeft, ChevronRight, Trash2, List } from 'lucide-react'
import { useQuickSwitch } from '@/lib/theme'

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
  const [activeIndex, setActiveIndex] = useState(0)
  const [quickSwitch] = useQuickSwitch()
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

  // If chain exists, preserve chain order. Otherwise sort prose naturally.
  const orderedFragments = activeFragments.length > 0
    ? activeFragments
    : [...fragments].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))

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
      const lastFragment = orderedFragments[orderedFragments.length - 1]
      if (lastFragment && (lastFragment.content === streamedText || lastFragment.meta?.generatedFrom)) {
        // Give a small delay so the transition is smooth
        const timeout = setTimeout(() => {
          setStreamedText('')
        }, 100)
        return () => clearTimeout(timeout)
      }
    }
  }, [orderedFragments, isGenerating, streamedText])

  // Track which prose block is currently visible
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport || orderedFragments.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.proseIndex)
            if (!isNaN(idx)) setActiveIndex(idx)
          }
        }
      },
      { root: viewport, rootMargin: '-40% 0px -40% 0px', threshold: 0 },
    )

    const blocks = viewport.querySelectorAll('[data-prose-index]')
    blocks.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [orderedFragments])

  const scrollToIndex = useCallback((index: number) => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    const el = viewport.querySelector(`[data-prose-index="${index}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  return (
    <div className="flex flex-1 min-h-0 relative" data-component-id="prose-chain-root">
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0" data-component-id="prose-chain-scroll">
        <div className="max-w-[38rem] mx-auto py-12 px-8">
          {orderedFragments.length > 0 ? (
            orderedFragments.map((fragment, idx) => (
              <ProseBlock
                key={fragment.id}
                storyId={storyId}
                fragment={fragment}
                displayIndex={idx}
                sectionIndex={getSectionIndex(fragment.id)}
                chainEntry={getChainEntry(fragment.id)}
                isLast={idx === orderedFragments.length - 1 && !isGenerating}
                isFirst={idx === 0}
                onSelect={() => onSelectFragment(fragment)}
                onDebugLog={onDebugLog}
                quickSwitch={quickSwitch}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center" data-component-id="prose-empty-state">
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
            <div className="relative mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300" data-component-id="prose-streaming-block">
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

      {/* Outline toggle + panel */}
      {orderedFragments.length > 1 && (
        <ProseOutlinePanel
          fragments={orderedFragments}
          activeIndex={activeIndex}
          onJump={scrollToIndex}
        />
      )}
    </div>
  )
}

// --- Prose Outline Panel ---

function ProseOutlinePanel({
  fragments,
  activeIndex,
  onJump,
}: {
  fragments: Fragment[]
  activeIndex: number
  onJump: (index: number) => void
}) {
  const [open, setOpen] = useState(false)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Scroll the active item into view when panel opens or active changes
  useEffect(() => {
    if (open && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [open, activeIndex])

  // Extract a short preview from fragment content
  const preview = (content: string) => {
    const line = content.replace(/\n+/g, ' ').trim()
    return line.length > 60 ? line.slice(0, 60) + '\u2026' : line
  }

  return (
    <>
      {/* Toggle button — fixed to right edge */}
      <button
        onClick={() => setOpen(!open)}
        data-component-id="prose-outline-toggle"
        className={`absolute right-3 top-4 z-20 flex items-center justify-center size-7 rounded-md transition-all duration-200 ${
          open
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground/25 hover:text-muted-foreground/60 hover:bg-accent/50'
        }`}
        title="Outline"
      >
        <List className="size-3.5" />
      </button>

      {/* Outline panel */}
      <div
        data-component-id="prose-outline-panel"
        className={`absolute right-0 top-0 bottom-0 z-10 flex flex-col border-l border-border/40 bg-background/95 backdrop-blur-sm transition-all duration-250 ease-out ${
          open
            ? 'w-56 opacity-100 translate-x-0'
            : 'w-0 opacity-0 translate-x-4 pointer-events-none'
        }`}
        style={{ willChange: 'width, opacity, transform' }}
      >
        {/* Header */}
        <div className="shrink-0 px-4 pt-14 pb-3">
          <h3 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40 font-medium">
            Passages
          </h3>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 px-2 pb-4">
          {fragments.map((fragment, idx) => {
            const isActive = idx === activeIndex
            return (
              <button
                key={fragment.id}
                ref={isActive ? activeRef : undefined}
                data-component-id={`prose-outline-item-${idx}`}
                onClick={() => {
                  onJump(idx)
                }}
                className={`w-full text-left rounded-md px-2.5 py-2 mb-0.5 transition-colors duration-100 group/item ${
                  isActive
                    ? 'bg-accent/70'
                    : 'hover:bg-accent/40'
                }`}
              >
                <span className={`block text-[10px] font-mono mb-0.5 ${
                  isActive ? 'text-primary/70' : 'text-muted-foreground/25'
                }`}>
                  {idx + 1}
                </span>
                <span className={`block text-[11px] leading-snug font-prose ${
                  isActive
                    ? 'text-foreground/80'
                    : 'text-muted-foreground/45 group-hover/item:text-muted-foreground/65'
                }`}>
                  {preview(fragment.content)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

interface InlineGenerationInputProps {
  storyId: string
  isGenerating: boolean
  streamedText: string
  onGenerationStart: () => void
  onGenerationStream: (text: string) => void
  onGenerationComplete: () => void
  onGenerationError: () => void
}

function InlineGenerationInput({
  storyId,
  isGenerating,
  onGenerationStart,
  onGenerationStream,
  onGenerationComplete,
  onGenerationError,
}: InlineGenerationInputProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Provider quick-switch queries
  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })
  const { data: globalConfig } = useQuery({
    queryKey: ['global-config'],
    queryFn: () => api.config.getProviders(),
  })
  const providerMutation = useMutation({
    mutationFn: (data: { providerId?: string | null; modelId?: string | null }) =>
      api.settings.update(storyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
    },
  })

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [input])

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
    onGenerationError()
  }

  // Resolve current model label
  const modelLabel = (() => {
    if (!globalConfig) return null
    const providers = globalConfig.providers.filter(p => p.enabled)
    if (story?.settings.providerId) {
      const p = providers.find(p => p.id === story.settings.providerId)
      if (p) return p.defaultModel
    }
    const defaultP = globalConfig.defaultProviderId
      ? providers.find(p => p.id === globalConfig.defaultProviderId)
      : null
    return defaultP?.defaultModel ?? 'deepseek-chat'
  })()

  return (
    <div className="relative mt-2" data-component-id="inline-generation-root">
      {/* Error */}
      {error && (
        <div className="text-sm text-destructive mb-3 font-sans">
          {error}
        </div>
      )}

      {/* Unified input container */}
      <div
        className={`relative rounded-xl border transition-all duration-300 ${
          isFocused
            ? 'border-primary/25 shadow-[0_0_0_1px_var(--primary)/8%,0_2px_12px_-2px_var(--primary)/6%] bg-card/60'
            : 'border-border/30 bg-card/20 hover:border-border/50 hover:bg-card/30'
        }`}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          data-component-id="inline-generation-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="What happens next..."
          rows={1}
          className="w-full resize-none bg-transparent border-none outline-none px-4 pt-3.5 pb-2 font-prose text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/30 placeholder:italic disabled:opacity-40"
          style={{ minHeight: '44px', maxHeight: '200px' }}
          disabled={isGenerating}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              handleGenerate()
            }
          }}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
          {/* Left: Write button + shortcut hint */}
          <div className="flex items-center gap-2.5">
            {isGenerating ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 rounded-lg border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleStop}
                data-component-id="inline-generation-stop"
              >
                <span className="size-1.5 bg-destructive rounded-[2px]" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5 rounded-lg font-medium"
                onClick={handleGenerate}
                disabled={!input.trim()}
                data-component-id="inline-generation-submit"
              >
                <PenLine className="size-3" />
                Write
              </Button>
            )}
            {!isGenerating && (
              <span className="text-[10px] text-muted-foreground/30 font-sans select-none">
                Ctrl+Enter
              </span>
            )}
          </div>

          {/* Right: Model selector */}
          {globalConfig && (
            <div className="relative group/model">
              <select
                data-component-id="inline-generation-provider-select"
                value={story?.settings.providerId ?? ''}
                onChange={(e) => {
                  const providerId = e.target.value || null
                  providerMutation.mutate({ providerId, modelId: null })
                }}
                disabled={providerMutation.isPending || isGenerating}
                className="text-[10px] text-muted-foreground/40 bg-muted/40 hover:bg-muted/70 border border-border/20 hover:border-border/40 rounded-md outline-none cursor-pointer transition-all duration-200 appearance-none pl-2 pr-5 py-1 font-mono max-w-[180px] truncate disabled:opacity-30 disabled:cursor-default focus:ring-1 focus:ring-primary/20 focus:border-primary/30"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                title={modelLabel ?? undefined}
              >
                {(() => {
                  const providers = globalConfig.providers.filter(p => p.enabled)
                  const defaultProvider = globalConfig.defaultProviderId
                    ? providers.find(p => p.id === globalConfig.defaultProviderId)
                    : null
                  return (
                    <>
                      <option value="">
                        {defaultProvider
                          ? `${defaultProvider.defaultModel}`
                          : `deepseek-chat`}
                      </option>
                      {providers
                        .filter(p => p.id !== globalConfig.defaultProviderId)
                        .map(p => (
                          <option key={p.id} value={p.id}>
                            {p.defaultModel}
                          </option>
                        ))}
                    </>
                  )
                })()}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProseBlock({
  storyId,
  fragment,
  displayIndex,
  sectionIndex,
  chainEntry,
  isLast,
  isFirst,
  onSelect,
  onDebugLog,
  quickSwitch,
}: {
  storyId: string
  fragment: Fragment
  displayIndex: number
  sectionIndex: number
  chainEntry: import('@/lib/api').ProseChainEntry | null
  isLast: boolean
  isFirst?: boolean
  onSelect: () => void
  onDebugLog?: (logId: string) => void
  quickSwitch?: boolean
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

  const switchMutation = useMutation({
    mutationFn: (fragmentId: string) =>
      api.proseChain.switchVariation(storyId, sectionIndex, fragmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.proseChain.removeSection(storyId, sectionIndex),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId, 'prose'] })
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
    },
  })

  const variationCount = chainEntry?.proseFragments.length ?? 0
  const variationIndex = chainEntry?.proseFragments.findIndex(f => f.id === chainEntry.active) ?? -1
  const hasMultiple = variationCount > 1
  const canPrev = hasMultiple && variationIndex > 0
  const canNext = hasMultiple && variationIndex < variationCount - 1

  const switchVariation = (dir: -1 | 1) => {
    if (!chainEntry) return
    const nextIdx = variationIndex + dir
    if (nextIdx < 0 || nextIdx >= variationCount) return
    switchMutation.mutate(chainEntry.proseFragments[nextIdx].id)
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
    <div className="group relative mb-6" data-prose-index={displayIndex} data-component-id={`prose-${fragment.id}-block`}>
      {/* User prompt divider */}
      {fragment.description && (
        <div className="flex items-center gap-3 mb-2 -mt-3 -mx-4 px-4">
          <div className="h-px flex-1 bg-border/30" />
          <span className="text-[10px] text-muted-foreground/30 italic shrink-0">{fragment.description}</span>
          <div className="h-px flex-1 bg-border/30" />
        </div>
      )}

      {/* Quick switch chevrons */}
      {quickSwitch && hasMultiple && (
        <div className="flex items-center justify-between -mx-4 px-1 mb-1">
          <button
            onClick={() => switchVariation(-1)}
            disabled={!canPrev || switchMutation.isPending}
            data-component-id={`prose-${fragment.id}-variation-prev`}
            className={`p-0.5 rounded transition-colors ${
              canPrev
                ? 'text-muted-foreground/40 hover:text-muted-foreground'
                : 'text-muted-foreground/10 cursor-default'
            }`}
            title="Previous variation"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="text-[9px] text-muted-foreground/30">
            {variationIndex + 1}/{variationCount}
          </span>
          <button
            onClick={() => switchVariation(1)}
            disabled={!canNext || switchMutation.isPending}
            data-component-id={`prose-${fragment.id}-variation-next`}
            className={`p-0.5 rounded transition-colors ${
              canNext
                ? 'text-muted-foreground/40 hover:text-muted-foreground'
                : 'text-muted-foreground/10 cursor-default'
            }`}
            title="Next variation"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (isLast) {
            setEditContent(fragment.content)
            setEditing(true)
          } else {
            onSelect()
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (isLast) {
              setEditContent(fragment.content)
              setEditing(true)
            } else {
              onSelect()
            }
          }
        }}
        className="text-left w-full rounded-lg p-4 -mx-4 transition-colors duration-150 hover:bg-card/40 cursor-pointer"
        data-component-id={`prose-${fragment.id}-select`}
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
          {!!fragment.meta?.generatedFrom && (
            <button
              className="text-muted-foreground/40 hover:text-primary transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                onDebugLog?.(fragment.id)
              }}
              title="View debug log"
            >
              <Bug className="size-3.5" />
            </button>
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
              data-component-id={`prose-${fragment.id}-regenerate`}
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
              data-component-id={`prose-${fragment.id}-refine`}
              onClick={(e) => {
                e.stopPropagation()
                setActionMode('refine')
              }}
            >
              <Sparkles className="size-3" />
            </Button>
            {sectionIndex >= 0 && (
              <Button
                size="icon"
                variant="ghost"
                className="size-6 text-muted-foreground/50 hover:text-destructive"
                title="Remove passage"
                disabled={deleteMutation.isPending}
                data-component-id={`prose-${fragment.id}-remove`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm('Remove this passage? It will be archived and can be restored later.')) {
                    deleteMutation.mutate()
                  }
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            )}
            {isLast && (
              <span className="text-[10px] text-muted-foreground/40 ml-1">
                click to edit
              </span>
            )}
          </div>
        </div>
      </div>

      {showUndo && (
        <div className="flex items-center gap-2 mt-1 px-4">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs gap-1"
            onClick={() => revertMutation.mutate()}
            disabled={revertMutation.isPending}
            data-component-id={`prose-${fragment.id}-undo`}
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

    </div>
  )
}
