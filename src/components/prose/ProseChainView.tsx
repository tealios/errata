import { useState, useEffect, useRef, useCallback, useMemo, memo, Fragment as ReactFragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment, type ProseChainEntry } from '@/lib/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StreamMarkdown } from '@/components/ui/stream-markdown'
import { Loader2, Wand2, Bookmark } from 'lucide-react'
import { useQuickSwitch, useProseWidth, PROSE_WIDTH_VALUES, useCharacterMentions } from '@/lib/theme'
import { ProseBlock } from './ProseBlock'
import { ChapterMarker } from './ChapterMarker'
import { InlineGenerationInput, type ThoughtStep } from './InlineGenerationInput'
import { GenerationThoughts } from './GenerationThoughts'
import { ProseOutlinePanel } from './ProseOutlinePanel'
import { CharacterMentionProvider } from './CharacterMentionContext'

interface ProseChainViewProps {
  storyId: string
  coverImage?: string | null
  onSelectFragment: (fragment: Fragment) => void
  onEditProse?: (fragmentId: string) => void
  onDebugLog?: (logId: string) => void
  onLaunchWizard?: () => void
  onAskLibrarian?: (fragmentId: string) => void
}

/** Thin hover zone between blocks that reveals a "+ Chapter" insert button */
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
    <div className="group/insert relative h-3 -my-1 flex items-center justify-center">
      <button
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending}
        className="opacity-0 group-hover/insert:opacity-100 transition-opacity duration-200 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-amber-500/60 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20"
      >
        <Bookmark className="size-2.5" />
        <span>Chapter</span>
      </button>
    </div>
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
  const FOLLOW_GENERATION_KEY = 'errata:follow-generation'
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamedText, setStreamedText] = useState('')
  const [thoughtSteps, setThoughtSteps] = useState<ThoughtStep[]>([])
  const [fragmentCountBeforeGeneration, setFragmentCountBeforeGeneration] = useState<number | null>(null)
  const [followGeneration, setFollowGeneration] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem(FOLLOW_GENERATION_KEY)
    if (saved === '0') return false
    if (saved === '1') return true
    return true
  })
  const queryClient = useQueryClient()

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(FOLLOW_GENERATION_KEY, followGeneration ? '1' : '0')
  }, [followGeneration])

  const scrollRafRef = useRef(0)
  useEffect(() => {
    if (followGeneration && isGenerating && (streamedText || thoughtSteps.length > 0) && scrollAreaRef.current) {
      cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = requestAnimationFrame(() => {
        const scrollContainer = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight
        }
      })
    }
  }, [streamedText, thoughtSteps, followGeneration, isGenerating, scrollAreaRef])

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
              />
            )}
            <StreamMarkdown content={streamedText} streaming={isGenerating} variant="prose" />
            {isGenerating && (
              <div className="flex items-center gap-2 mt-3 opacity-60">
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">
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
        followGeneration={followGeneration}
        onToggleFollowGeneration={() => setFollowGeneration((value) => !value)}
      />
    </>
  )
}

export function ProseChainView({
  storyId,
  coverImage,
  onSelectFragment,
  onEditProse,
  onDebugLog,
  onLaunchWizard,
  onAskLibrarian,
}: ProseChainViewProps) {

  const [activeIndex, setActiveIndex] = useState(0)
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

  const { data: imageFragments = [] } = useQuery({
    queryKey: ['fragments', storyId, 'image'],
    queryFn: () => api.fragments.list(storyId, 'image'),
    enabled: mentionsEnabled,
  })

  const { data: iconFragments = [] } = useQuery({
    queryKey: ['fragments', storyId, 'icon'],
    queryFn: () => api.fragments.list(storyId, 'icon'),
    enabled: mentionsEnabled,
  })

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
    if (restoredRef.current || orderedItems.length === 0) return
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
  }, [orderedItems, SCROLL_POS_KEY])

  // Track which prose block is currently visible
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
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
  }, [orderedItems])

  const scrollToIndex = useCallback((index: number) => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    const el = viewport.querySelector(`[data-prose-index="${index}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'instant', block: 'start' })
  }, [])

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

  const scrollToBottom = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
  }, [])

  return (
    <div className="flex flex-1 min-h-0 relative" data-component-id="prose-chain-root">
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0" data-component-id="prose-chain-scroll">
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
        <div className="mx-auto py-6 px-4 sm:py-12 sm:px-8" style={{ maxWidth: PROSE_WIDTH_VALUES[proseWidth] }}>
          {orderedItems.length > 0 ? (
            orderedItems.map((fragment, idx) => (
              <ReactFragment key={fragment.id}>
                {idx === 0 && <InsertChapterDivider storyId={storyId} position={0} />}
                {fragment.type === 'marker' ? (
                  <ChapterMarker
                    storyId={storyId}
                    fragment={fragment}
                    displayIndex={idx}
                    sectionIndex={sectionIndexMap.get(fragment.id) ?? -1}
                    onSelect={onSelectFragment}
                    onDelete={handleDeleteSection}
                  />
                ) : (
                  <ProseBlock
                    storyId={storyId}
                    fragment={fragment}
                    displayIndex={idx}
                    sectionIndex={sectionIndexMap.get(fragment.id) ?? -1}
                    chainEntry={chainEntryMap.get(fragment.id) ?? null}
                    isLast={idx === orderedItems.length - 1}
                    isFirst={idx === 0}
                    onSelect={onSelectFragment}
                    onEdit={onEditProse}
                    onDebugLog={onDebugLog}
                    onBranchFrom={handleBranchFrom}
                    onAskLibrarian={onAskLibrarian}
                    quickSwitch={quickSwitch}
                    mentionsEnabled={mentionsEnabled}
                    mentionColors={mentionColors}
                    onClickMention={handleMentionClick}
                  />
                )}
                <InsertChapterDivider storyId={storyId} position={idx + 1} />
              </ReactFragment>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center" data-component-id="prose-empty-state">
              <p className="font-display text-2xl italic text-muted-foreground mb-2">
                The page awaits.
              </p>
              <p className="text-sm text-muted-foreground mb-8 max-w-xs leading-relaxed">
                Write your first passage below, or let the wizard help you set up your story.
              </p>
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

      {/* Outline toggle + panel — hidden on mobile */}
      {orderedItems.length > 1 && (
        <div className="hidden md:flex">
          <ProseOutlinePanel
            storyId={storyId}
            fragments={orderedItems}
            activeIndex={activeIndex}
            onJump={scrollToIndex}
            onScrollToBottom={scrollToBottom}
          />
        </div>
      )}
    </div>
  )
}
