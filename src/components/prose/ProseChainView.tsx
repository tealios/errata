import { useState, useEffect, useRef, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StreamMarkdown } from '@/components/ui/stream-markdown'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { RefreshCw, Sparkles, Undo2, Loader2, PenLine, Bug, ChevronLeft, ChevronRight, Trash2, List, ChevronsDown } from 'lucide-react'
import { useQuickSwitch } from '@/lib/theme'

interface ProseChainViewProps {
  storyId: string
  onSelectFragment: (fragment: Fragment) => void
  onDebugLog?: (logId: string) => void
}

export function ProseChainView({
  storyId,
  onSelectFragment,
  onDebugLog,
}: ProseChainViewProps) {
  const FOLLOW_GENERATION_KEY = 'errata:follow-generation'
  // State for streaming generation
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamedText, setStreamedText] = useState('')
  const [fragmentCountBeforeGeneration, setFragmentCountBeforeGeneration] = useState<number | null>(null)
  const [followGeneration, setFollowGeneration] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem(FOLLOW_GENERATION_KEY)
    if (saved === '0') return false
    if (saved === '1') return true
    return true
  })
  const [activeIndex, setActiveIndex] = useState(0)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [quickSwitch] = useQuickSwitch()

  // Co-locate both queries so they settle in the same component — prevents
  // desync after regeneration where the chain points to a fragment the stale
  // prop hadn't included yet.
  const { data: proseChain } = useQuery({
    queryKey: ['proseChain', storyId],
    queryFn: () => api.proseChain.get(storyId),
  })

  const { data: fragments = [] } = useQuery({
    queryKey: ['fragments', storyId, 'prose'],
    queryFn: () => api.fragments.list(storyId, 'prose'),
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(FOLLOW_GENERATION_KEY, followGeneration ? '1' : '0')
  }, [followGeneration])

  // Persist scroll position to sessionStorage
  const SCROLL_POS_KEY = `errata:scroll-pos:${storyId}`
  const restoredRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return

    const handleScroll = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        sessionStorage.setItem(SCROLL_POS_KEY, String(viewport.scrollTop))
      }, 150)
    }

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [SCROLL_POS_KEY])

  // Restore scroll position once fragments are loaded
  useEffect(() => {
    if (restoredRef.current || orderedFragments.length === 0) return
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return

    const saved = sessionStorage.getItem(SCROLL_POS_KEY)
    if (saved) {
      const pos = Number(saved)
      if (!isNaN(pos)) {
        requestAnimationFrame(() => {
          viewport.scrollTop = pos
        })
      }
    }
    restoredRef.current = true
  }, [orderedFragments, SCROLL_POS_KEY])

  // Scroll to bottom when streaming new content
  useEffect(() => {
    if (followGeneration && isGenerating && streamedText && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [streamedText, followGeneration, isGenerating])

  // Clear streamed text once fragments update (new prose was saved)
  useEffect(() => {
    if (!isGenerating && streamedText && fragmentCountBeforeGeneration !== null) {
      // Check if a new fragment was added (count increased) or if the last fragment's content matches
      const currentCount = orderedFragments.length
      const lastFragment = orderedFragments[orderedFragments.length - 1]
      
      // Clear if fragment count increased (new fragment added) or content matches
      if (currentCount > fragmentCountBeforeGeneration ||
          (lastFragment && lastFragment.content === streamedText)) {
        // Give a small delay so the transition is smooth
        const timeout = setTimeout(() => {
          setStreamedText('')
          setFragmentCountBeforeGeneration(null)
        }, 100)
        return () => clearTimeout(timeout)
      }
    }
  }, [orderedFragments, isGenerating, streamedText, fragmentCountBeforeGeneration])

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

  const scrollToBottom = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
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
                <StreamMarkdown content={streamedText} streaming={isGenerating} variant="prose" />

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
            onGenerationStart={() => {
              setIsGenerating(true)
              setStreamedText('')
              setFragmentCountBeforeGeneration(orderedFragments.length)
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
            followGeneration={followGeneration}
            onToggleFollowGeneration={() => setFollowGeneration((value) => !value)}
          />
        </div>
      </ScrollArea>

      {/* Outline toggle + panel */}
      {orderedFragments.length > 1 && (
        <ProseOutlinePanel
          fragments={orderedFragments}
          activeIndex={activeIndex}
          onJump={scrollToIndex}
          onScrollToBottom={scrollToBottom}
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
  onScrollToBottom,
}: {
  fragments: Fragment[]
  activeIndex: number
  onJump: (index: number) => void
  onScrollToBottom: () => void
}) {
  const OUTLINE_OPEN_KEY = 'errata:passages-panel-open'
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem(OUTLINE_OPEN_KEY)
    if (saved === '0') return false
    if (saved === '1') return true
    return true
  })
  const activeRef = useRef<HTMLButtonElement>(null)
  const collapsedActiveRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(OUTLINE_OPEN_KEY, open ? '1' : '0')
  }, [open])

  // Scroll the active item into view when panel opens or active changes
  useEffect(() => {
    if (open && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    if (!open && collapsedActiveRef.current) {
      collapsedActiveRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [open, activeIndex])

  // Extract a short preview from fragment content
  const preview = (content: string) => {
    const line = content.replace(/\n+/g, ' ').trim()
    return line.length > 60 ? line.slice(0, 60) + '\u2026' : line
  }

  return (
    <>
      {/* Outline panel */}
      <div
        data-component-id="prose-outline-panel"
        className={`shrink-0 flex flex-col border-l border-border/40 bg-background/95 backdrop-blur-sm transition-all duration-250 ease-out overflow-hidden ${
          open ? 'w-56' : 'w-7'
        }`}
        style={{ willChange: 'width' }}
      >
        {/* Toggle button — always inside the panel */}
        <div className={`shrink-0 flex pt-4 pb-2 ${open ? 'px-3' : 'justify-center'}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setOpen(!open)}
                data-component-id="prose-outline-toggle"
                className={`flex items-center justify-center size-7 rounded-md transition-all duration-200 ${
                  open
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground/25 hover:text-muted-foreground/60 hover:bg-accent/50'
                }`}
              >
                <List className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{open ? 'Collapse outline' : 'Expand outline'}</TooltipContent>
          </Tooltip>
        </div>

        {open ? (
          /* --- Expanded view --- */
          <>
            {/* Header */}
            <div className="shrink-0 px-4 pb-3">
              <h3 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40 font-medium">
                Passages
              </h3>
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 px-2 pb-2">
              {fragments.map((fragment, idx) => {
                const isActive = idx === activeIndex
                return (
                  <button
                    key={fragment.id}
                    ref={isActive ? activeRef : undefined}
                    data-component-id={`prose-outline-item-${idx}`}
                    onClick={() => onJump(idx)}
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

            {/* Scroll to bottom */}
            <div className="shrink-0 px-2 pb-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onScrollToBottom}
                    data-component-id="prose-outline-scroll-bottom"
                    className="w-full flex items-center justify-center gap-1.5 rounded-md py-1.5 text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-accent/40 transition-colors"
                  >
                    <ChevronsDown className="size-3.5" />
                    <span className="text-[10px]">Bottom</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">Scroll to bottom</TooltipContent>
              </Tooltip>
            </div>
          </>
        ) : (
          /* --- Collapsed rail view --- */
          <>
            {/* Dot indicators */}
            <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 flex flex-col items-center py-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
              {fragments.map((_, idx) => {
                const isActive = idx === activeIndex
                return (
                  <Tooltip key={idx}>
                    <TooltipTrigger asChild>
                      <button
                        ref={isActive ? collapsedActiveRef : undefined}
                        onClick={() => onJump(idx)}
                        data-component-id={`prose-outline-dot-${idx}`}
                        className="shrink-0 flex items-center justify-center w-7 h-5 group/dot"
                      >
                        <span className={`block rounded-full transition-all duration-150 ${
                          isActive
                            ? 'w-3 h-3 bg-primary/60'
                            : 'w-2 h-2 bg-muted-foreground/15 group-hover/dot:w-3 group-hover/dot:h-3 group-hover/dot:bg-muted-foreground/35'
                        }`} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-[10px]">{idx + 1}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>

            {/* Scroll to bottom */}
            <div className="shrink-0 flex justify-center pb-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onScrollToBottom}
                    data-component-id="prose-outline-scroll-bottom"
                    className="flex items-center justify-center w-7 h-6 rounded-md text-muted-foreground/25 hover:text-muted-foreground/60 hover:bg-accent/40 transition-colors"
                  >
                    <ChevronsDown className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">Scroll to bottom</TooltipContent>
              </Tooltip>
            </div>
          </>
        )}
      </div>
    </>
  )
}

interface InlineGenerationInputProps {
  storyId: string
  isGenerating: boolean
  followGeneration: boolean
  onToggleFollowGeneration: () => void
  onGenerationStart: () => void
  onGenerationStream: (text: string) => void
  onGenerationComplete: () => void
  onGenerationError: () => void
}

function InlineGenerationInput({
  storyId,
  isGenerating,
  followGeneration,
  onToggleFollowGeneration,
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
          style={{ minHeight: '44px', maxHeight: '200px', overflowY: 'auto', scrollbarWidth: 'none' }}
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
          {/* Left: Model selector + Follow toggle */}
          <div className="flex items-center gap-2">
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
                  className="text-[10px] text-foreground/60 bg-muted/50 hover:bg-muted/70 border border-border/40 hover:border-border/60 rounded-md outline-none cursor-pointer transition-all duration-200 appearance-none pl-2 pr-5 py-1 font-mono max-w-[180px] truncate disabled:opacity-30 disabled:cursor-default focus:ring-1 focus:ring-primary/20 focus:border-primary/30"
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={followGeneration ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs rounded-lg"
                  onClick={onToggleFollowGeneration}
                  data-component-id="inline-generation-follow-toggle"
                >
                  {followGeneration ? 'Follow' : 'Fixed'}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {followGeneration
                  ? 'Auto-scrolls to follow new text as it generates'
                  : 'Scroll stays in place during generation'}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Right: Write/Stop button + shortcut hint */}
          <div className="flex items-center gap-2.5">
            {!isGenerating && (
              <span className="text-[10px] text-muted-foreground/30 font-sans select-none">
                Ctrl+Enter
              </span>
            )}
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
          </div>
        </div>
      </div>
    </div>
  )
}

/** Full-height chevron rail that follows cursor vertically */
function ChevronRail({ direction, disabled, onClick, fragmentId }: {
  direction: 'prev' | 'next'
  disabled: boolean
  onClick: () => void
  fragmentId: string
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const [chevronY, setChevronY] = useState<number | null>(null)
  const [proximity, setProximity] = useState(0)
  const isLeft = direction === 'prev'

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const block = rail.closest('[data-prose-index]') as HTMLElement | null
    if (!block) return

    const handleMove = (e: MouseEvent) => {
      const blockRect = block.getBoundingClientRect()
      const railRect = rail.getBoundingClientRect()

      // Chevron Y position relative to rail
      const relY = e.clientY - railRect.top
      const clamped = Math.max(12, Math.min(relY, railRect.height - 12))
      setChevronY(clamped)

      // Proximity: how close the cursor is to the rail edge (0=far, 1=on it)
      const distFromEdge = isLeft
        ? e.clientX - blockRect.left
        : blockRect.right - e.clientX
      // Map 0..120px from edge → 1..0 proximity
      const norm = Math.max(0, Math.min(1, 1 - distFromEdge / 120))
      setProximity(norm)
    }

    const handleLeave = () => {
      setChevronY(null)
      setProximity(0)
    }

    block.addEventListener('mousemove', handleMove)
    block.addEventListener('mouseleave', handleLeave)
    return () => {
      block.removeEventListener('mousemove', handleMove)
      block.removeEventListener('mouseleave', handleLeave)
    }
  }, [isLeft])

  return (
    <div
      ref={railRef}
      className={`absolute top-0 bottom-0 w-12 z-20 flex items-center justify-center ${
        isLeft ? '-left-12' : '-right-12'
      }`}
      style={{ cursor: disabled ? 'default' : 'pointer' }}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick() }}
      data-component-id={`prose-${fragmentId}-variation-${direction}`}
    >
      <div
        className="absolute transition-opacity duration-75"
        style={{
          top: chevronY !== null ? chevronY - 12 : '50%',
          transform: chevronY === null ? 'translateY(-50%)' : undefined,
          opacity: disabled ? 0.08 : Math.max(0.08, proximity * 0.7),
        }}
      >
        {isLeft
          ? <ChevronLeft className="size-6 text-muted-foreground" />
          : <ChevronRight className="size-6 text-muted-foreground" />
        }
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
  quickSwitch: boolean
}) {
  // isFirst/isLast are part of the interface for future use
  void isFirst
  void isLast
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(fragment.content)
  const [actionMode, setActionMode] = useState<'regenerate' | 'refine' | null>(null)
  const [showUndo, setShowUndo] = useState(false)
  const [isStreamingAction, setIsStreamingAction] = useState(false)
  const [streamedActionText, setStreamedActionText] = useState('')
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showActions, setShowActions] = useState(false)
  const [actionInput, setActionInput] = useState('')
  const blockRef = useRef<HTMLDivElement>(null)
  const actionInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  // Dismiss action panel on outside click
  useEffect(() => {
    if (!showActions && !actionMode) return
    const handler = (e: MouseEvent) => {
      if (blockRef.current && !blockRef.current.contains(e.target as Node)) {
        setShowActions(false)
        setActionMode(null)
        setActionInput('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showActions, actionMode])

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
  const generatedFrom = typeof fragment.meta?.generatedFrom === 'string'
    ? fragment.meta.generatedFrom.trim()
    : ''
  const quickRegenerateInput = generatedFrom || fragment.description?.trim() || ''
  const canQuickRegenerate = !!quickRegenerateInput

  const switchVariation = (dir: -1 | 1) => {
    if (!chainEntry) return
    const nextIdx = variationIndex + dir
    if (nextIdx < 0 || nextIdx >= variationCount) return
    switchMutation.mutate(chainEntry.proseFragments[nextIdx].id)
  }

  const handleQuickRegenerate = async () => {
    if (!canQuickRegenerate || isStreamingAction) return

    setActionMode(null)
    setIsStreamingAction(true)
    setStreamedActionText('')

    try {
      const stream = await api.generation.regenerate(storyId, fragment.id, quickRegenerateInput)
      const reader = stream.getReader()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += value
        setStreamedActionText(accumulated)
      }

      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      handleActionComplete()
    } catch {
      setIsStreamingAction(false)
      setStreamedActionText('')
    }
  }

  const handleActionSubmit = async () => {
    if (!actionInput.trim() || isStreamingAction) return

    const mode = actionMode
    setActionMode(null)
    setShowActions(false)
    setIsStreamingAction(true)
    setStreamedActionText('')

    try {
      const stream = mode === 'refine'
        ? await api.generation.refine(storyId, fragment.id, actionInput)
        : await api.generation.regenerate(storyId, fragment.id, actionInput)

      const reader = stream.getReader()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += value
        setStreamedActionText(accumulated)
      }

      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      handleActionComplete()
    } catch {
      setIsStreamingAction(false)
      setStreamedActionText('')
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
    <div ref={blockRef} className="group relative mb-6" data-prose-index={displayIndex} data-component-id={`prose-${fragment.id}-block`}>
      {/* User prompt divider */}
      {fragment.description && (
        <div className="flex items-center gap-3 mb-2 -mt-3 -mx-4 px-4">
          <div className="h-px flex-1 bg-border/30" />
          <span className="text-[10px] text-muted-foreground/30 italic shrink-0">{fragment.description}</span>
          {hasMultiple && (
            <span className="text-[10px] font-mono text-muted-foreground/20 shrink-0">{variationIndex + 1}/{variationCount}</span>
          )}
          <div className="h-px flex-1 bg-border/30" />
        </div>
      )}

      {/* Hover chevron rails — full-height, cursor-following */}
      {quickSwitch && (hasMultiple || canQuickRegenerate) && (
        <>
          <ChevronRail
            direction="prev"
            disabled={!canPrev || switchMutation.isPending}
            onClick={() => switchVariation(-1)}
            fragmentId={fragment.id}
          />
          <ChevronRail
            direction="next"
            disabled={!canNext && !canQuickRegenerate}
            onClick={() => {
              if (canNext) { switchVariation(1); return }
              handleQuickRegenerate()
            }}
            fragmentId={fragment.id}
          />
        </>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!isStreamingAction) setShowActions(v => !v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setShowActions(false); return }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (!isStreamingAction) setShowActions(v => !v)
          }
        }}
        className={`text-left w-full rounded-lg p-4 -mx-4 transition-all duration-150 cursor-pointer ${
          showActions ? 'bg-card/50 ring-1 ring-primary/10' : 'hover:bg-card/40'
        }`}
        data-component-id={`prose-${fragment.id}-select`}
      >
        <StreamMarkdown
          content={(isStreamingAction || streamedActionText)
            ? streamedActionText || ''
            : fragment.content
          }
          streaming={isStreamingAction}
          variant="prose"
        />

      </div>

      {/* Action panel — sticky to bottom of scroll area, contained to prose column */}
      {(showActions || actionMode) && !isStreamingAction && (
        <div className="sticky bottom-4 z-10 flex justify-center py-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex flex-col items-center rounded-2xl border border-border/50 bg-popover/95 backdrop-blur-md shadow-2xl shadow-black/10 overflow-hidden min-w-0">
            {/* Info row — ID, prompt (clickable to re-run), variation, debug */}
            <div className="flex items-center gap-2 px-3 py-1.5 min-w-0 w-full">
              <span className="text-[10px] font-mono text-muted-foreground/35 shrink-0">{fragment.id}</span>
              {hasMultiple && (
                <>
                  <span className="text-muted-foreground/15 shrink-0">&middot;</span>
                  <span className="text-[10px] font-mono text-muted-foreground/30 shrink-0">{variationIndex + 1}/{variationCount}</span>
                </>
              )}
              {(generatedFrom || fragment.description) && (
                <>
                  <span className="text-muted-foreground/15 shrink-0">&middot;</span>
                  <button
                    className="text-[10px] text-muted-foreground/40 italic truncate hover:text-primary/70 transition-colors text-left"
                    onClick={() => {
                      setActionMode('regenerate')
                      setActionInput(generatedFrom || fragment.description || '')
                    }}
                    title="Click to edit and regenerate"
                  >
                    {generatedFrom || fragment.description}
                  </button>
                </>
              )}
              <div className="ml-auto flex items-center gap-1 shrink-0">
                {!!fragment.meta?.generatedFrom && onDebugLog && (
                  <button
                    className="p-1 rounded-lg text-muted-foreground/30 hover:text-primary hover:bg-accent/50 transition-all"
                    onClick={() => { onDebugLog(fragment.id); setShowActions(false) }}
                    title="View debug log"
                  >
                    <Bug className="size-3" />
                  </button>
                )}
              </div>
            </div>
            {/* Separator */}
            <div className="h-px bg-border/30 w-full" />

            {actionMode ? (
              /* Inline action input */
              <div className="px-3 py-2 w-full max-w-lg">
                <textarea
                  ref={actionInputRef}
                  value={actionInput}
                  onChange={(e) => setActionInput(e.target.value)}
                  placeholder={actionMode === 'regenerate' ? 'New direction...' : 'How to refine...'}
                  className="w-full resize-none rounded-lg border border-border/40 bg-transparent px-3 py-2 text-sm placeholder:italic placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary/30"
                  rows={2}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setActionMode(null)
                      setActionInput('')
                    }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      handleActionSubmit()
                    }
                  }}
                />
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-muted-foreground/30">
                    Esc to cancel &middot; Ctrl+Enter to {actionMode}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      className="px-2.5 py-1 rounded-lg text-[11px] text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-all"
                      onClick={() => { setActionMode(null); setActionInput('') }}
                    >
                      Cancel
                    </button>
                    <button
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-40 transition-all"
                      disabled={!actionInput.trim()}
                      onClick={handleActionSubmit}
                    >
                      {actionMode === 'regenerate' ? 'Regenerate' : 'Refine'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Action row */
              <div className="inline-flex items-center gap-0.5 px-1.5 py-1">
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-all"
                  onClick={() => { setEditContent(fragment.content); setEditing(true); setShowActions(false) }}
                  data-component-id={`prose-${fragment.id}-edit`}
                >
                  <PenLine className="size-3" />
                  Edit
                </button>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-all disabled:opacity-30"
                  onClick={() => {
                    setShowActions(false)
                    handleQuickRegenerate()
                  }}
                  disabled={!canQuickRegenerate}
                  data-component-id={`prose-${fragment.id}-regenerate`}
                >
                  <RefreshCw className="size-3" />
                  Regenerate
                </button>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-all"
                  onClick={() => { setActionMode('refine'); setActionInput('') }}
                  data-component-id={`prose-${fragment.id}-refine`}
                >
                  <Sparkles className="size-3" />
                  Refine
                </button>
                <div className="w-px h-4 bg-border/30 mx-0.5" />
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-muted-foreground/70 hover:text-foreground hover:bg-accent/80 transition-all"
                  onClick={() => { onSelect(); setShowActions(false) }}
                >
                  Details
                </button>
                {sectionIndex >= 0 && (
                  <>
                    <div className="w-px h-4 bg-border/30 mx-0.5" />
                    <button
                      className="inline-flex items-center p-1.5 rounded-xl text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm('Remove this passage? It will be archived.')) {
                          deleteMutation.mutate()
                          setShowActions(false)
                        }
                      }}
                      data-component-id={`prose-${fragment.id}-remove`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

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

    </div>
  )
}
