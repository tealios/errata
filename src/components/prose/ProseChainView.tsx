import { useState, useEffect, useRef, useCallback, useMemo, memo, Fragment as ReactFragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { api, type Fragment, type ProseChainEntry } from '@/lib/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StreamMarkdown } from '@/components/ui/stream-markdown'
import { Loader2, Wand2, Bookmark, List } from 'lucide-react'
import { Hint } from '@/components/ui/prose-text'
import { useQuickSwitch, useProseWidth, PROSE_WIDTH_VALUES, useCharacterMentions } from '@/lib/theme'
import { parseVisualRefs } from '@/lib/fragment-visuals'
import { ProseBlock } from './ProseBlock'
import { ChapterMarker } from './ChapterMarker'
import { InlineGenerationInput, type ThoughtStep } from './InlineGenerationInput'
import { GenerationThoughts } from './GenerationThoughts'
import { ProseOutlinePanel } from './ProseOutlinePanel'
import { CharacterMentionProvider } from './CharacterMentionContext'

interface ProseChainViewProps {
  storyId: string
  coverImage?: string | null
  outlineOpen?: boolean
  onSelectFragment: (fragment: Fragment) => void
  onEditProse?: (fragmentId: string, selectedText?: string) => void
  onDebugLog?: (logId: string) => void
  onLaunchWizard?: () => void
  onAskLibrarian?: (fragmentId: string, prefill?: string) => void
}

/** Thin hover zone between blocks that reveals a "+ Chapter" insert button */
// An always-visible typographic break between prose blocks. The hairline +
// italic serif label reads as a book-section ornament at rest; hovering
// brightens both and invites a click. Anywhere along the line inserts a
// new chapter marker at this position. Hidden adjacent to existing markers
// so we never stack a chapter hint against a real chapter boundary.
const InsertChapterDivider = memo(function InsertChapterDivider({
  storyId,
  position,
}: {
  storyId: string
  position: number
}) {
  const queryClient = useQueryClient()
  const createMutation = useMutation({
    mutationFn: () =>
      api.chapters.create(storyId, {
        name: `Chapter ${position + 1}`,
        position,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
    },
  })

  return (
    <button
      type="button"
      onClick={() => createMutation.mutate()}
      disabled={createMutation.isPending}
      aria-label="Insert chapter marker here"
      className="group/insert min-h-6 w-full flex items-center gap-3 py-1.5 my-0.5 transition-opacity focus-visible:outline-none focus-visible:opacity-100"
    >
      <span aria-hidden className="flex-1 h-px bg-border/30 group-hover/insert:bg-primary/40 transition-colors" />
      <span className="text-[0.6875rem] font-display italic text-muted-foreground group-hover/insert:text-foreground transition-colors whitespace-nowrap flex items-center gap-1.5">
        <Bookmark className="size-2.5 text-muted-foreground group-hover/insert:text-primary transition-colors" aria-hidden />
        <span>chapter</span>
      </span>
      <span aria-hidden className="flex-1 h-px bg-border/30 group-hover/insert:bg-primary/40 transition-colors" />
    </button>
  )
})

/**
 * Owns all streaming generation state so that rapid stream-chunk updates
 * only re-render this subtree, not the entire prose list above.
 */
function StreamingSection({
  storyId,
  proseFragmentCount,
  lastFragmentContent,
  scrollAreaRef,
}: {
  storyId: string
  proseFragmentCount: number
  lastFragmentContent: string | undefined
  scrollAreaRef: React.RefObject<HTMLDivElement | null>
}) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamedText, setStreamedText] = useState('')
  const [thoughtSteps, setThoughtSteps] = useState<ThoughtStep[]>([])
  const [fragmentCountBeforeGeneration, setFragmentCountBeforeGeneration] = useState<number | null>(null)
  const followRef = useRef(true)
  const lastTopRef = useRef(0)
  const queryClient = useQueryClient()
  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })

  // Auto-follow the bottom while generating. Any user scroll-up disengages it; returning to the
  // bottom re-engages. The pin only ever moves scrollTop toward the bottom, so a decrease is the user.
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    const onScroll = () => {
      if (viewport.scrollTop < lastTopRef.current - 2) followRef.current = false
      else if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24) followRef.current = true
      lastTopRef.current = viewport.scrollTop
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [scrollAreaRef])

  // Re-engage auto-follow at the start of each generation
  useEffect(() => {
    if (isGenerating) followRef.current = true
  }, [isGenerating])

  const scrollRafRef = useRef(0)
  useEffect(() => {
    if (!isGenerating || (!streamedText && thoughtSteps.length === 0)) return
    cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport && followRef.current) {
        viewport.scrollTop = viewport.scrollHeight
        lastTopRef.current = viewport.scrollTop
      }
    })
  }, [streamedText, thoughtSteps, isGenerating, scrollAreaRef])

  useEffect(() => {
    if (!isGenerating && streamedText && fragmentCountBeforeGeneration !== null) {
      if (proseFragmentCount > fragmentCountBeforeGeneration ||
          lastFragmentContent === streamedText) {
        const timeout = setTimeout(() => {
          setStreamedText('')
          setThoughtSteps([])
          setFragmentCountBeforeGeneration(null)
        }, 100)
        return () => clearTimeout(timeout)
      }

      const retryTimeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
        queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      }, 500)
      return () => clearTimeout(retryTimeout)
    }
  }, [proseFragmentCount, lastFragmentContent, isGenerating, streamedText, fragmentCountBeforeGeneration, queryClient, storyId])

  return (
    <>
      {(isGenerating || streamedText) && (
        <div className="relative mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300" data-component-id="prose-streaming-block">
          <div className="rounded-lg p-4 -mx-4 bg-card/30">
            {thoughtSteps.length > 0 && (
              <GenerationThoughts
                steps={thoughtSteps}
                streaming={isGenerating}
                hasText={!!streamedText}
                defaultExpanded={story?.settings.expandThoughtsByDefault ?? true}
              />
            )}
            <StreamMarkdown content={streamedText} streaming={isGenerating} variant="prose" />
            {isGenerating && (
              <div className="flex items-center gap-2 mt-3 opacity-60">
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
                <span className="text-[0.625rem] text-muted-foreground">
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
          setThoughtSteps([])
          setFragmentCountBeforeGeneration(proseFragmentCount)
        }}
        onGenerationStream={setStreamedText}
        onGenerationThoughts={setThoughtSteps}
        onGenerationComplete={() => setIsGenerating(false)}
        onGenerationError={() => setIsGenerating(false)}
      />
    </>
  )
}

export function ProseChainView({
  storyId,
  coverImage,
  outlineOpen,
  onSelectFragment,
  onEditProse,
  onDebugLog,
  onLaunchWizard,
  onAskLibrarian,
}: ProseChainViewProps) {

  const [activeIndex, setActiveIndex] = useState(0)
  const [mobileTocOpen, setMobileTocOpen] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [quickSwitch] = useQuickSwitch()
  const [proseWidth] = useProseWidth()
  const [mentionsEnabled] = useCharacterMentions()
  const queryClient = useQueryClient()

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

  const { data: markerFragments = [] } = useQuery({
    queryKey: ['fragments', storyId, 'marker'],
    queryFn: () => api.fragments.list(storyId, 'marker'),
  })

  const { data: characterFragments = [] } = useQuery({
    queryKey: ['fragments', storyId, 'character'],
    queryFn: () => api.fragments.list(storyId, 'character'),
    enabled: mentionsEnabled,
  })

  // Prose headers need image fragments even when character-mentions are off.
  const anyProseHasImage = useMemo(
    () => fragments.some((f) => parseVisualRefs(f.meta).some((r) => r.kind === 'image')),
    [fragments],
  )

  const { data: imageFragments = [] } = useQuery({
    queryKey: ['fragments', storyId, 'image'],
    queryFn: () => api.fragments.list(storyId, 'image'),
    enabled: mentionsEnabled || anyProseHasImage,
  })

  const { data: iconFragments = [] } = useQuery({
    queryKey: ['fragments', storyId, 'icon'],
    queryFn: () => api.fragments.list(storyId, 'icon'),
    enabled: mentionsEnabled,
  })

  const { data: analysisIndex } = useQuery({
    queryKey: ['librarian-analysis-index', storyId],
    queryFn: () => api.librarian.getAnalysisIndex(storyId),
    refetchInterval: 10_000,
  })

  const analyzedFragments = useMemo(
    () => new Set(Object.keys(analysisIndex ?? {})),
    [analysisIndex],
  )

  const analyzeMutation = useMutation({
    mutationFn: (fragmentId: string) => api.librarian.analyze(storyId, fragmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['librarian-analysis-index', storyId] })
    },
  })

  const handleAnalyze = useCallback((fragmentId: string) => {
    analyzeMutation.mutate(fragmentId)
  }, [analyzeMutation])

  // Build media lookup for character portraits in hover cards
  const mediaById = useMemo(() => {
    const map = new Map<string, Fragment>()
    for (const f of imageFragments) map.set(f.id, f)
    for (const f of iconFragments) map.set(f.id, f)
    return map
  }, [imageFragments, iconFragments])

  // Build color overrides from character `color=` tags.
  // Ref-stabilised: return the previous Map when entries haven't changed so
  // downstream memo'd components keep the same reference.
  const mentionColorsRef = useRef<Map<string, string>>(new Map())
  const mentionColors = useMemo(() => {
    const next = new Map<string, string>()
    for (const char of characterFragments) {
      const tag = char.tags.find(t => t.startsWith('color='))
      if (!tag) continue
      const value = tag.slice(6)
      if (/^#[0-9a-fA-F]{3,8}$/.test(value) || value.startsWith('oklch(')) {
        next.set(char.id, value)
      }
    }
    const prev = mentionColorsRef.current
    if (prev.size === next.size) {
      let same = true
      for (const [k, v] of next) {
        if (prev.get(k) !== v) { same = false; break }
      }
      if (same) return prev
    }
    mentionColorsRef.current = next
    return next
  }, [characterFragments])

  // Build combined fragment map from prose + markers
  const allFragmentsMap = useMemo(() => {
    const map = new Map<string, Fragment>()
    for (const f of fragments) map.set(f.id, f)
    for (const f of markerFragments) map.set(f.id, f)
    return map
  }, [fragments, markerFragments])

  // Build ordered items from chain entries using the combined map
  const orderedItems = useMemo(() => {
    if (!proseChain?.entries.length) {
      // Fallback: no chain, show prose sorted naturally (no markers possible)
      return [...fragments].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
    }
    const items: Fragment[] = []
    for (const entry of proseChain.entries) {
      const fragment = allFragmentsMap.get(entry.active)
      if (fragment) items.push(fragment)
    }
    return items
  }, [proseChain, allFragmentsMap, fragments])

  // Prose-only subset for generation count tracking
  const orderedProseFragments = useMemo(
    () => orderedItems.filter(f => f.type !== 'marker'),
    [orderedItems],
  )

  // Precompute lookup maps so children receive stable references
  const sectionIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!proseChain) return map
    for (let i = 0; i < proseChain.entries.length; i++) {
      for (const f of proseChain.entries[i].proseFragments) {
        map.set(f.id, i)
      }
    }
    return map
  }, [proseChain])

  const chainEntryMap = useMemo(() => {
    const map = new Map<string, ProseChainEntry>()
    if (!proseChain) return map
    for (const entry of proseChain.entries) {
      for (const f of entry.proseFragments) {
        map.set(f.id, entry)
      }
    }
    return map
  }, [proseChain])

  const handleDeleteSection = useCallback((sectionIndex: number) => {
    api.proseChain.removeSection(storyId, sectionIndex).then(() => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
    })
  }, [storyId, queryClient])

  // Stable ref to the Radix scroll-area viewport element
  const viewportRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (scrollAreaRef.current) {
      viewportRef.current = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
    }
  }, [])
  const getViewport = useCallback(() => viewportRef.current, [])

  // Measure offset from viewport top to the list container (accounts for cover image + padding)
  const listContainerRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  useEffect(() => {
    const viewport = getViewport()
    const container = listContainerRef.current
    if (!viewport || !container) return
    const measure = () => {
      setScrollMargin(container.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    return () => ro.disconnect()
  }, [coverImage, getViewport])

  // Whether to use virtualization (skip for short lists)
  const useVirtual = orderedItems.length > 10

  const virtualizer = useVirtualizer({
    count: orderedItems.length,
    getScrollElement: getViewport,
    estimateSize: (i) => {
      const item = orderedItems[i]
      if (!item) return 200
      return item.type === 'marker' ? 100 : Math.max(120, Math.min(600, (item.content?.length ?? 0) * 0.3 + 80))
    },
    overscan: 3,
    scrollMargin,
    enabled: useVirtual,
    onChange: (instance) => {
      const items = instance.getVirtualItems()
      if (!items.length) return
      const viewport = instance.scrollElement
      if (!viewport) return
      const center = viewport.scrollTop + viewport.clientHeight / 2
      for (const item of items) {
        if (item.start <= center && item.end >= center) {
          setActiveIndex(item.index)
          return
        }
      }
      setActiveIndex(items[items.length - 1].index)
    },
  })

  // Persist scroll position to sessionStorage
  const SCROLL_POS_KEY = `errata:scroll-pos:${storyId}`
  const restoredRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const viewport = getViewport()
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
  }, [SCROLL_POS_KEY, getViewport])

  // Restore scroll position once fragments are loaded
  useEffect(() => {
    if (restoredRef.current || orderedItems.length === 0) return
    const viewport = getViewport()
    if (!viewport) return

    const saved = sessionStorage.getItem(SCROLL_POS_KEY)
    if (saved) {
      const pos = Number(saved)
      if (!isNaN(pos)) {
        requestAnimationFrame(() => {
          viewport.scrollTop = pos
          if (useVirtual) virtualizer.measure()
        })
      }
    }
    restoredRef.current = true
  }, [orderedItems, SCROLL_POS_KEY, getViewport, useVirtual, virtualizer])

  // Track active index for non-virtualized mode (IntersectionObserver)
  useEffect(() => {
    if (useVirtual) return // virtualizer onChange handles this
    const viewport = getViewport()
    if (!viewport || orderedItems.length === 0) return

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
  }, [orderedItems, useVirtual, getViewport])

  const scrollToIndex = useCallback((index: number) => {
    if (useVirtual) {
      virtualizer.scrollToIndex(index, { align: 'start' })
    } else {
      const viewport = getViewport()
      if (!viewport) return
      const el = viewport.querySelector(`[data-prose-index="${index}"]`) as HTMLElement | null
      el?.scrollIntoView({ behavior: 'instant', block: 'start' })
    }
  }, [useVirtual, virtualizer, getViewport])

  const branchFromMutation = useMutation({
    mutationFn: async (sectionIndex: number) => {
      const name = window.prompt('Timeline name:')
      if (!name?.trim()) throw new Error('Cancelled')
      const index = await api.branches.list(storyId)
      return api.branches.create(storyId, {
        name: name.trim(),
        parentBranchId: index.activeBranchId,
        forkAfterIndex: sectionIndex,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches', storyId] })
      queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    },
  })

  const handleBranchFrom = useCallback((sectionIndex: number) => {
    branchFromMutation.mutate(sectionIndex)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFromMutation.mutate])

  const handleMentionClick = useCallback((fragmentId: string) => {
    // Find the character fragment from the already-fetched prose fragments won't work;
    // we need to fetch the character fragment directly
    api.fragments.get(storyId, fragmentId).then(fragment => {
      if (fragment) onSelectFragment(fragment)
    }).catch(() => {
      // Fragment may have been deleted
    })
  }, [storyId, onSelectFragment])

  return (
    <div className="flex flex-1 min-h-0 relative" data-component-id="prose-chain-root">
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0 min-w-0" data-component-id="prose-chain-scroll">
        {/* Cover image banner */}
        {coverImage && (
          <div className="relative w-full overflow-hidden" style={{ maxHeight: 280 }}>
            <img
              src={coverImage}
              alt=""
              className="w-full h-full object-cover"
              style={{ maxHeight: 280 }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
          </div>
        )}
        <CharacterMentionProvider characters={characterFragments} mediaById={mediaById}>
        <div className="mx-auto w-full py-6 px-4 sm:py-12 sm:px-8" style={{ maxWidth: PROSE_WIDTH_VALUES[proseWidth] }}>
          {orderedItems.length > 0 ? (
            useVirtual ? (
              /* Virtualized rendering for long stories */
              <div ref={listContainerRef} style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const fragment = orderedItems[virtualItem.index]
                  const idx = virtualItem.index
                  const sectionIdx = sectionIndexMap.get(fragment.id) ?? -1
                  const stableKey = sectionIdx >= 0 ? `section-${sectionIdx}` : fragment.id
                  const isMarker = fragment.type === 'marker'
                  const nextIsMarker = orderedItems[idx + 1]?.type === 'marker'
                  return (
                    <div
                      key={stableKey}
                      data-index={virtualItem.index}
                      data-prose-index={idx}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`,
                      }}
                    >
                      {idx === 0 && !isMarker && <InsertChapterDivider storyId={storyId} position={0} />}
                      {isMarker ? (
                        <ChapterMarker
                          storyId={storyId}
                          fragment={fragment}
                          displayIndex={idx}
                          sectionIndex={sectionIdx}
                          onSelect={onSelectFragment}
                          onDelete={handleDeleteSection}
                        />
                      ) : (
                        <ProseBlock
                          storyId={storyId}
                          fragment={fragment}
                          displayIndex={idx}
                          sectionIndex={sectionIdx}
                          chainEntry={chainEntryMap.get(fragment.id) ?? null}
                          isLast={idx === orderedItems.length - 1}
                          isFirst={idx === 0}
                          onSelect={onSelectFragment}
                          onEdit={onEditProse}
                          onDebugLog={onDebugLog}
                          onBranchFrom={handleBranchFrom}
                          onAskLibrarian={onAskLibrarian}
                          onAnalyze={handleAnalyze}
                          hasAnalysis={analyzedFragments.has(fragment.id)}
                          quickSwitch={quickSwitch}
                          mentionsEnabled={mentionsEnabled}
                          mentionColors={mentionColors}
                          onClickMention={handleMentionClick}
                          mediaById={mediaById}
                        />
                      )}
                      {!isMarker && !nextIsMarker && (
                        <InsertChapterDivider storyId={storyId} position={idx + 1} />
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              /* Non-virtualized rendering for short stories (<=10 items) */
              <div ref={listContainerRef}>
                {orderedItems.map((fragment, idx) => {
                  const sectionIdx = sectionIndexMap.get(fragment.id) ?? -1
                  const stableKey = sectionIdx >= 0 ? `section-${sectionIdx}` : fragment.id
                  const isMarker = fragment.type === 'marker'
                  const nextIsMarker = orderedItems[idx + 1]?.type === 'marker'
                  return (
                    <ReactFragment key={stableKey}>
                      {idx === 0 && !isMarker && <InsertChapterDivider storyId={storyId} position={0} />}
                      {isMarker ? (
                        <ChapterMarker
                          storyId={storyId}
                          fragment={fragment}
                          displayIndex={idx}
                          sectionIndex={sectionIdx}
                          onSelect={onSelectFragment}
                          onDelete={handleDeleteSection}
                        />
                      ) : (
                        <ProseBlock
                          storyId={storyId}
                          fragment={fragment}
                          displayIndex={idx}
                          sectionIndex={sectionIdx}
                          chainEntry={chainEntryMap.get(fragment.id) ?? null}
                          isLast={idx === orderedItems.length - 1}
                          isFirst={idx === 0}
                          onSelect={onSelectFragment}
                          onEdit={onEditProse}
                          onDebugLog={onDebugLog}
                          onBranchFrom={handleBranchFrom}
                          onAskLibrarian={onAskLibrarian}
                          onAnalyze={handleAnalyze}
                          hasAnalysis={analyzedFragments.has(fragment.id)}
                          quickSwitch={quickSwitch}
                          mentionsEnabled={mentionsEnabled}
                          mentionColors={mentionColors}
                          onClickMention={handleMentionClick}
                          mediaById={mediaById}
                        />
                      )}
                      {!isMarker && !nextIsMarker && (
                        <InsertChapterDivider storyId={storyId} position={idx + 1} />
                      )}
                    </ReactFragment>
                  )
                })}
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center" data-component-id="prose-empty-state">
              <p className="font-display text-2xl italic text-muted-foreground mb-2">
                The page awaits.
              </p>
              <Hint size="sm" className="mb-8 max-w-xs leading-relaxed">
                Write your first passage below, or let the wizard help you set up your story.
              </Hint>
              {onLaunchWizard && (
                <button
                  onClick={onLaunchWizard}
                  className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl border-2 border-primary/20 bg-primary/[0.04] text-sm font-medium text-primary/80 hover:text-primary hover:border-primary/40 hover:bg-primary/[0.08] transition-all duration-200"
                >
                  <Wand2 className="size-4" />
                  <span>Story Setup Wizard</span>
                </button>
              )}
            </div>
          )}

          <StreamingSection
            storyId={storyId}
            proseFragmentCount={orderedProseFragments.length}
            lastFragmentContent={orderedProseFragments[orderedProseFragments.length - 1]?.content}
            scrollAreaRef={scrollAreaRef}
          />
        </div>
        </CharacterMentionProvider>
      </ScrollArea>

      {/* Outline panel — side rail on desktop */}
      {orderedItems.length > 1 && (
        <div className="hidden md:flex">
          <ProseOutlinePanel
            storyId={storyId}
            fragments={orderedItems}
            activeIndex={activeIndex}
            open={outlineOpen ?? true}
            onJump={scrollToIndex}
          />
        </div>
      )}

      {/* Outline on mobile — a trigger that opens the passages as a full-screen
          overlay (no room for a persistent rail). Sits left of the chat button. */}
      {orderedItems.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setMobileTocOpen(true)}
            title="Passages"
            aria-label="Open passages outline"
            data-component-id="prose-mobile-toc-trigger"
            className="md:hidden absolute top-3 right-14 z-20 flex items-center justify-center size-9 rounded-md bg-background/80 backdrop-blur-sm border border-border/40 shadow-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <List className="size-4" />
          </button>
          {mobileTocOpen && (
            <div
              className="md:hidden fixed inset-0 z-40 bg-background animate-in fade-in duration-150"
              data-cuelume-surface="bloom"
              data-component-id="prose-mobile-toc-overlay"
            >
              <ProseOutlinePanel
                storyId={storyId}
                fragments={orderedItems}
                activeIndex={activeIndex}
                open
                mobile
                onClose={() => setMobileTocOpen(false)}
                onJump={(i) => { scrollToIndex(i); setMobileTocOpen(false) }}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
