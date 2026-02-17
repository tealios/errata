import { useState, useEffect, useRef, useCallback } from 'react'
import { useHelp } from '@/hooks/use-help'
import { useIsMobile } from '@/hooks/use-mobile'
import { HELP_SECTIONS, findSection, type HelpSection } from './help-content'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X, BookOpen, ChevronRight, ArrowLeft } from 'lucide-react'
import { componentId } from '@/lib/dom-ids'

/** Scroll to a help anchor inside a Radix ScrollArea. Returns true if successful. */
function scrollToHelpAnchor(container: HTMLElement, anchorId: string): boolean {
  const viewport = container.querySelector('[data-slot="scroll-area-viewport"]') ?? container.querySelector('[data-radix-scroll-area-viewport]')
  const target = container.querySelector(`[data-help-anchor="${anchorId}"]`)
  if (!viewport || !target) return false
  const viewportRect = viewport.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const offset = targetRect.top - viewportRect.top + viewport.scrollTop - 16
  viewport.scrollTo({ top: offset, behavior: 'smooth' })
  return true
}

/**
 * The global help panel. Reads state from the HelpProvider context.
 * Renders as a right-side drawer on desktop, full-screen on mobile.
 */
export function HelpPanel() {
  const { state, closeHelp, openHelp } = useHelp()
  const isMobile = useIsMobile()
  const { open, section: sectionId, anchor, seq } = state

  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)

  // Mount/unmount animation
  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
    } else {
      setVisible(false)
    }
    wasOpen.current = open
  }, [open])

  const handleTransitionEnd = useCallback(() => {
    if (!open) setMounted(false)
  }, [open])

  // Scroll to anchor when section/anchor changes, with retry for fresh mounts
  useEffect(() => {
    if (!open || !anchor || !scrollAreaRef.current) return
    const el = scrollAreaRef.current
    let attempt = 0
    const maxAttempts = 5
    const tryScroll = () => {
      if (scrollToHelpAnchor(el, anchor)) return
      if (++attempt < maxAttempts) {
        timers.push(setTimeout(tryScroll, 80))
      }
    }
    const timers: ReturnType<typeof setTimeout>[] = []
    // Initial delay: short if already open, longer if freshly mounting
    timers.push(setTimeout(tryScroll, wasOpen.current ? 50 : 150))
    return () => timers.forEach(clearTimeout)
    // mounted: re-run when content actually renders (first render returns null)
    // seq: force re-scroll even when navigating to the same anchor twice
  }, [open, mounted, sectionId, anchor, seq])

  if (!mounted) return null

  const activeSection = sectionId ? findSection(sectionId) : null

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-250 ${
          visible ? 'bg-foreground/8 backdrop-blur-[2px]' : 'bg-transparent pointer-events-none'
        }`}
        onClick={closeHelp}
        aria-hidden
        data-component-id="help-backdrop"
      />

      {/* Panel */}
      <div
        onTransitionEnd={handleTransitionEnd}
        className={`fixed z-50 flex flex-col bg-background border-r border-border/40 shadow-2xl shadow-foreground/5 ${
          isMobile
            ? `inset-0 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`
            : `top-0 left-0 bottom-0 w-[440px] transition-transform duration-250 ease-out ${
                visible ? 'translate-x-0' : '-translate-x-full'
              }`
        }`}
        data-component-id="help-panel-root"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-b border-border/30">
          <div className="flex items-center gap-2.5 min-w-0">
            {activeSection && (
              <button
                onClick={() => openHelp()}
                className="shrink-0 p-1 -ml-1 rounded-md text-muted-foreground/40 hover:text-foreground/70 transition-colors"
                title="Back to topics"
                data-component-id="help-back"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            <BookOpen className="size-4 text-muted-foreground/35 shrink-0" />
            <h2 className="font-display text-lg truncate">
              {activeSection ? activeSection.title : 'Help'}
            </h2>
          </div>
          <button
            onClick={closeHelp}
            className="shrink-0 p-1.5 rounded-md text-muted-foreground/35 hover:text-foreground/70 hover:bg-accent/30 transition-colors"
            data-component-id="help-close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden" ref={scrollAreaRef} data-component-id="help-scroll">
          <ScrollArea className="h-full">
            <div className="px-6 py-5">
              {activeSection ? (
                <SectionView section={activeSection} scrollAreaRef={scrollAreaRef} />
              ) : (
                <TopicIndex onSelect={(id) => openHelp(id)} />
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border/20 px-6 py-3">
          <p className="text-[10px] text-muted-foreground/25 text-center leading-relaxed">
            Press <kbd className="px-1 py-0.5 rounded border border-border/30 bg-muted/30 text-[9px] font-mono">Esc</kbd> to close
          </p>
        </div>
      </div>
    </>
  )
}

/**
 * Topic index — shown when no section is selected.
 * Displays all help sections as cards.
 */
function TopicIndex({ onSelect }: { onSelect: (sectionId: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground/40 leading-relaxed mb-4">
        Select a topic to learn more about Errata's features.
      </p>
      {HELP_SECTIONS.map((section, idx) => (
        <button
          key={section.id}
          onClick={() => onSelect(section.id)}
          className="w-full text-left rounded-lg border border-border/25 hover:border-border/50 bg-accent/10 hover:bg-accent/25 px-4 py-3.5 transition-all duration-150 group"
          style={{ animationDelay: `${idx * 40}ms` }}
          data-component-id={componentId('help-topic', section.id)}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-foreground/80 group-hover:text-foreground transition-colors">
                {section.title}
              </p>
              <p className="text-[11px] text-muted-foreground/40 mt-0.5 leading-snug">
                {section.description}
              </p>
            </div>
            <ChevronRight className="size-3.5 text-muted-foreground/25 group-hover:text-muted-foreground/50 shrink-0 transition-colors" />
          </div>
          {/* Subsection preview */}
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-2">
            {section.subsections.map((sub) => (
              <span key={sub.id} className="text-[10px] text-muted-foreground/30">
                {sub.title}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  )
}

/**
 * Renders a single help section with all its subsections.
 */
function SectionView({ section, scrollAreaRef }: { section: HelpSection; scrollAreaRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="space-y-6">
      {/* Section description */}
      <p className="text-[12px] text-muted-foreground/45 leading-relaxed -mt-1">
        {section.description}
      </p>

      {/* Table of contents */}
      <nav className="rounded-lg border border-border/20 bg-accent/10 px-4 py-3">
        <p className="text-[10px] text-muted-foreground/35 uppercase tracking-wider mb-2">On this page</p>
        <div className="space-y-1">
          {section.subsections.map((sub) => (
            <button
              key={sub.id}
              onClick={() => {
                if (scrollAreaRef.current) scrollToHelpAnchor(scrollAreaRef.current, sub.id)
              }}
              className="block text-left text-[11.5px] text-foreground/50 hover:text-foreground/80 transition-colors py-0.5"
              data-component-id={componentId('help-nav', sub.id)}
            >
              {sub.title}
            </button>
          ))}
        </div>
      </nav>

      {/* Subsections */}
      {section.subsections.map((sub, idx) => (
        <div
          key={sub.id}
          data-help-anchor={sub.id}
          className="scroll-mt-4"
        >
          {idx > 0 && <div className="h-px bg-border/15 mb-5" />}
          <h3 className="font-display text-[15px] text-foreground/85 mb-3">
            {sub.title}
          </h3>
          <div>{sub.content}</div>
        </div>
      ))}
    </div>
  )
}
