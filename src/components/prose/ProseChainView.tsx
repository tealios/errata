import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StreamMarkdown } from '@/components/ui/stream-markdown'
import { Loader2, Wand2 } from 'lucide-react'
import { useQuickSwitch, useProseWidth, PROSE_WIDTH_VALUES, useCharacterMentions } from '@/lib/theme'
import { ProseBlock } from './ProseBlock'
import { InlineGenerationInput, type ThoughtStep } from './InlineGenerationInput'
import { GenerationThoughts } from './GenerationThoughts'
import { ProseOutlinePanel } from './ProseOutlinePanel'

interface ProseChainViewProps {
  storyId: string
  onSelectFragment: (fragment: Fragment) => void
  onDebugLog?: (logId: string) => void
  onLaunchWizard?: () => void
  onAskLibrarian?: (fragmentId: string) => void
}

export function ProseChainView({
  storyId,
  onSelectFragment,
  onDebugLog,
  onLaunchWizard,
  onAskLibrarian,
}: ProseChainViewProps) {
  const FOLLOW_GENERATION_KEY = 'errata:follow-generation'
  // State for streaming generation
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

  const { data: characterFragments = [] } = useQuery({
    queryKey: ['fragments', storyId, 'character'],
    queryFn: () => api.fragments.list(storyId, 'character'),
    enabled: mentionsEnabled,
  })

  // Build color overrides from character `color=` tags
  const mentionColors = useMemo(() => {
    const map = new Map<string, string>()
    for (const char of characterFragments) {
      const tag = char.tags.find(t => t.startsWith('color='))
      if (!tag) continue
      const value = tag.slice(6)
      if (/^#[0-9a-fA-F]{3,8}$/.test(value) || value.startsWith('oklch(')) {
        map.set(char.id, value)
      }
    }
    return map
  }, [characterFragments])

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

  // Scroll to bottom when streaming new content (throttled to RAF)
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
  }, [streamedText, thoughtSteps, followGeneration, isGenerating])

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
          setThoughtSteps([])
          setFragmentCountBeforeGeneration(null)
        }, 100)
        return () => clearTimeout(timeout)
      }

      // Fragment hasn't appeared yet — server save may still be in progress.
      // Re-invalidate queries after a short delay to pick up the saved fragment.
      const retryTimeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
        queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      }, 500)
      return () => clearTimeout(retryTimeout)
    }
  }, [orderedFragments, isGenerating, streamedText, fragmentCountBeforeGeneration, queryClient, storyId])

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
  }, [branchFromMutation])

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
        <div className="mx-auto py-6 px-4 sm:py-12 sm:px-8" style={{ maxWidth: PROSE_WIDTH_VALUES[proseWidth] }}>
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
                onBranchFrom={handleBranchFrom}
                onAskLibrarian={onAskLibrarian}
                quickSwitch={quickSwitch}
                mentionsEnabled={mentionsEnabled}
                mentionColors={mentionColors}
                onClickMention={handleMentionClick}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center" data-component-id="prose-empty-state">
              <p className="font-display text-2xl italic text-muted-foreground/40 mb-2">
                The page awaits.
              </p>
              <p className="text-sm text-muted-foreground/50 mb-8 max-w-xs leading-relaxed">
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

          {/* Streaming text displayed inline as part of the prose chain */}
          {(isGenerating || streamedText) && (
            <div className="relative mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300" data-component-id="prose-streaming-block">
              {/* Match prose block styling - no border, minimal background */}
              <div className="rounded-lg p-4 -mx-4 bg-card/30">
                {thoughtSteps.length > 0 && (
                  <GenerationThoughts
                    steps={thoughtSteps}
                    streaming={isGenerating}
                    hasText={!!streamedText}
                  />
                )}
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
              setThoughtSteps([])
              setFragmentCountBeforeGeneration(orderedFragments.length)
            }}
            onGenerationStream={(text) => setStreamedText(text)}
            onGenerationThoughts={(steps) => setThoughtSteps(steps)}
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

      {/* Outline toggle + panel — hidden on mobile */}
      {orderedFragments.length > 1 && (
        <div className="hidden md:flex">
          <ProseOutlinePanel
            fragments={orderedFragments}
            activeIndex={activeIndex}
            onJump={scrollToIndex}
            onScrollToBottom={scrollToBottom}
          />
        </div>
      )}
    </div>
  )
}

