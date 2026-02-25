import { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { api, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { FloatingElement } from '@/components/tiptap/FloatingElement'
import {
  Loader2,
  Sparkles,
  Wand2,
  Minimize2,
  X,
  Bookmark,
  Search,
  PanelRightClose,
  PanelRightOpen,
  ChevronUp,
  ChevronDown,
  Undo2,
  Check,
  Circle,
} from 'lucide-react'
import { useWritingTransforms } from '@/lib/theme'
import { cn } from '@/lib/utils'

type SelectionTransformMode = 'rewrite' | 'expand' | 'compress' | 'custom'

interface ProseWritingPanelProps {
  storyId: string
  fragmentId: string
  initialSelection?: string | null
  onClose: () => void
  onFragmentChange: (id: string) => void
}

/** Build ProseMirror JSON directly — avoids DOM parsing overhead of HTML path */
function plainTextToDoc(content: string): Record<string, unknown> {
  if (!content.trim()) return { type: 'doc', content: [{ type: 'paragraph' }] }
  return {
    type: 'doc',
    content: content.split('\n\n').map((para) => {
      if (!para) return { type: 'paragraph' }
      const lines = para.split('\n')
      if (lines.length === 1) {
        return { type: 'paragraph', content: [{ type: 'text', text: lines[0] }] }
      }
      const inline: Record<string, unknown>[] = []
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) inline.push({ type: 'text', text: lines[i] })
        if (i < lines.length - 1) inline.push({ type: 'hardBreak' })
      }
      return { type: 'paragraph', content: inline.length > 0 ? inline : [] }
    }),
  }
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

function readingTime(words: number): string {
  const minutes = Math.ceil(words / 238)
  if (minutes < 1) return '<1m'
  return `${minutes}m`
}

function preview(content: string): string {
  const line = content.replace(/\n+/g, ' ').trim()
  return line.length > 60 ? line.slice(0, 60) + '\u2026' : line
}

const PassageItem = memo(function PassageItem({
  fragment,
  isActive,
  proseNumber,
  onSwitch,
}: {
  fragment: Fragment
  isActive: boolean
  proseNumber: number
  onSwitch: (id: string) => void
}) {
  const wc = wordCount(fragment.content)
  return (
    <button
      data-passage-id={fragment.id}
      onClick={() => onSwitch(fragment.id)}
      className={cn(
        'w-full text-left rounded-lg px-2.5 py-2 mb-0.5 transition-all duration-150 group/item',
        isActive
          ? 'bg-primary/[0.08] ring-1 ring-primary/15'
          : 'hover:bg-accent/50',
      )}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className={cn(
          'text-[0.625rem] font-mono',
          isActive ? 'text-primary/70' : 'text-muted-foreground',
        )}>
          {proseNumber}
        </span>
        <span className={cn(
          'text-[0.5625rem] font-mono tabular-nums',
          isActive ? 'text-primary/40' : 'text-muted-foreground group-hover/item:text-muted-foreground',
        )}>
          {wc}w
        </span>
      </div>
      {fragment.description && (
        <span className={cn(
          'block text-[0.625rem] italic truncate mb-0.5',
          isActive
            ? 'text-muted-foreground'
            : 'text-muted-foreground group-hover/item:text-muted-foreground',
        )}>
          {fragment.description.slice(0, 50)}{fragment.description.length > 50 ? '\u2026' : ''}
        </span>
      )}
      <span className={cn(
        'block text-[0.6875rem] leading-snug font-prose line-clamp-2',
        isActive
          ? 'text-foreground/70'
          : 'text-muted-foreground group-hover/item:text-muted-foreground',
      )}>
        {preview(fragment.content)}
      </span>
    </button>
  )
})

function SaveIndicator({ saveState, isDirty }: { saveState: 'idle' | 'saving' | 'saved'; isDirty: boolean }) {
  if (saveState === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-[0.625rem] text-muted-foreground animate-in fade-in duration-150">
        <Loader2 className="size-2.5 animate-spin" />
        <span className="hidden sm:inline">Saving</span>
      </span>
    )
  }
  if (saveState === 'saved') {
    return (
      <span className="flex items-center gap-1.5 text-[0.625rem] text-emerald-500/70 animate-in fade-in duration-150">
        <Check className="size-2.5" />
        <span className="hidden sm:inline">Saved</span>
      </span>
    )
  }
  if (isDirty) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 text-[0.625rem] text-amber-500/60">
            <Circle className="size-1.5 fill-current" />
            <span className="hidden sm:inline">Unsaved</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">Ctrl+S to save</TooltipContent>
      </Tooltip>
    )
  }
  return null
}

export function ProseWritingPanel({
  storyId,
  fragmentId,
  initialSelection,
  onClose,
  onFragmentChange,
}: ProseWritingPanelProps) {
  const queryClient = useQueryClient()
  const [isTransformingSelection, setIsTransformingSelection] = useState(false)
  const [selectionTransformMode, setSelectionTransformMode] = useState<SelectionTransformMode | null>(null)
  const [selectionTransformReasoning, setSelectionTransformReasoning] = useState('')
  const [customTransformLabel, setCustomTransformLabel] = useState<string | null>(null)
  const [showTransformUndo, setShowTransformUndo] = useState(false)
  const [writingTransforms] = useWritingTransforms()
  const enabledTransforms = writingTransforms.filter(t => t.enabled)
  const sidebarScrollRef = useRef<HTMLDivElement>(null)
  const dirtyRef = useRef(false)
  const savingFragmentRef = useRef<string | null>(null)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const transformUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Queries
  const { data: proseChain } = useQuery({
    queryKey: ['proseChain', storyId],
    queryFn: () => api.proseChain.get(storyId),
  })

  const { data: proseFragments = [] } = useQuery({
    queryKey: ['fragments', storyId, 'prose'],
    queryFn: () => api.fragments.list(storyId, 'prose'),
  })

  const { data: markerFragments = [] } = useQuery({
    queryKey: ['fragments', storyId, 'marker'],
    queryFn: () => api.fragments.list(storyId, 'marker'),
  })

  // Build combined fragment map
  const allFragmentsMap = useMemo(() => {
    const map = new Map<string, Fragment>()
    for (const f of proseFragments) map.set(f.id, f)
    for (const f of markerFragments) map.set(f.id, f)
    return map
  }, [proseFragments, markerFragments])

  // Build ordered items from chain
  const orderedItems = useMemo(() => {
    if (!proseChain?.entries.length) {
      return [...proseFragments].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
    }
    const items: Fragment[] = []
    for (const entry of proseChain.entries) {
      const fragment = allFragmentsMap.get(entry.active)
      if (fragment) items.push(fragment)
    }
    return items
  }, [proseChain, allFragmentsMap, proseFragments])

  // Prose-only items (for navigation)
  const proseItems = useMemo(() => orderedItems.filter(f => f.type !== 'marker'), [orderedItems])

  // Current fragment + neighbors
  const currentFragment = allFragmentsMap.get(fragmentId)
  const currentProseIndex = proseItems.findIndex(f => f.id === fragmentId)
  const prevFragment = currentProseIndex > 0 ? proseItems[currentProseIndex - 1] : null
  const nextFragment = currentProseIndex < proseItems.length - 1 ? proseItems[currentProseIndex + 1] : null

  // Sidebar search filtering
  const filteredItems = useMemo(() => {
    if (!sidebarSearch.trim()) return orderedItems
    const q = sidebarSearch.toLowerCase()
    return orderedItems.filter(f => {
      if (f.type === 'marker') return f.name.toLowerCase().includes(q)
      return (
        f.content.toLowerCase().includes(q) ||
        (f.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [orderedItems, sidebarSearch])

  // Save mutation
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const updateMutation = useMutation({
    mutationFn: async ({ fId, content }: { fId: string; content: string }) => {
      setSaveState('saving')
      const frag = allFragmentsMap.get(fId)
      const [result] = await Promise.all([
        api.fragments.update(storyId, fId, {
          name: frag?.name ?? '',
          description: frag?.description ?? '',
          content,
        }),
        new Promise(r => setTimeout(r, 125)),
      ])
      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      dirtyRef.current = false
      savingFragmentRef.current = null
      setSaveState('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2000)
    },
    onError: () => {
      savingFragmentRef.current = null
      setSaveState('idle')
    },
  })

  // Tiptap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
      }),
    ],
    content: plainTextToDoc(currentFragment?.content ?? ''),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose-content font-prose max-w-none min-h-[60vh] px-6 sm:px-10 md:px-16 py-6 sm:py-8 focus:outline-none',
      },
    },
    onUpdate: () => {
      dirtyRef.current = true
      setSaveState('idle')
    },
  })

  // Sync editor content when the active fragment changes
  useEffect(() => {
    if (!editor || !currentFragment) return
    if (savingFragmentRef.current === fragmentId) return
    editor.commands.setContent(plainTextToDoc(currentFragment.content), { emitUpdate: false })
    dirtyRef.current = false
    setSaveState('idle')
    setSelectionTransformReasoning('')
    setSelectionTransformMode(null)
    setIsTransformingSelection(false)
    setShowTransformUndo(false)
  }, [editor, fragmentId, currentFragment?.content])

  // Apply initial text selection from prose view
  const initialSelectionApplied = useRef(false)
  useEffect(() => {
    if (!editor || !initialSelection || initialSelectionApplied.current) return
    initialSelectionApplied.current = true

    // Search for the selected text in the ProseMirror document
    const doc = editor.state.doc
    const docText = doc.textBetween(0, doc.content.size, '\n\n')
    const idx = docText.indexOf(initialSelection)
    if (idx === -1) return

    // Map plain-text offset to ProseMirror position by walking the doc
    const endIdx = idx + initialSelection.length
    let charsSeen = 0
    let from = -1
    let to = -1
    doc.descendants((node, pos) => {
      if (to !== -1) return false
      if (node.isText) {
        const start = charsSeen
        const end = charsSeen + node.text!.length
        if (from === -1 && idx >= start && idx < end) {
          from = pos + (idx - start)
        }
        if (from !== -1 && endIdx >= start && endIdx <= end) {
          to = pos + (endIdx - start)
          return false
        }
        charsSeen = end
      } else if (node.isBlock && charsSeen > 0) {
        // Account for paragraph separators (\n\n) in textBetween output
        charsSeen += 2
      }
      return true
    })

    if (from !== -1 && to !== -1) {
      editor.commands.setTextSelection({ from, to })
      editor.commands.focus()
      // Scroll the selection into view
      requestAnimationFrame(() => {
        editor.commands.scrollIntoView()
      })
    }
  }, [editor, initialSelection])

  // Track selection reactively
  const [hasSelection, setHasSelection] = useState(false)
  useEffect(() => {
    if (!editor) return
    const update = () => setHasSelection(!editor.state.selection.empty)
    update()
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  // Get plain text from editor
  const getEditorText = useCallback(() => {
    if (!editor) return ''
    return editor.getText({ blockSeparator: '\n\n' })
  }, [editor])

  // Save current content
  const handleSave = useCallback(() => {
    if (!editor || isTransformingSelection || saveState === 'saving') return
    const content = getEditorText()
    if (!currentFragment || content === currentFragment.content) {
      dirtyRef.current = false
      return
    }
    savingFragmentRef.current = fragmentId
    updateMutation.mutate({ fId: fragmentId, content })
  }, [editor, isTransformingSelection, saveState, updateMutation, getEditorText, currentFragment, fragmentId])

  // Auto-save if dirty, then switch to a different passage
  const handlePassageSwitch = useCallback((targetId: string) => {
    if (targetId === fragmentId) return
    if (dirtyRef.current && editor && currentFragment) {
      const content = getEditorText()
      if (content !== currentFragment.content) {
        savingFragmentRef.current = fragmentId
        updateMutation.mutate({ fId: fragmentId, content })
      }
    }
    dirtyRef.current = false
    onFragmentChange(targetId)
  }, [fragmentId, editor, currentFragment, getEditorText, updateMutation, onFragmentChange])

  // Stable ref so memoized sidebar items don't re-render when the callback identity changes
  const passageSwitchRef = useRef(handlePassageSwitch)
  passageSwitchRef.current = handlePassageSwitch
  const stablePassageSwitch = useCallback((id: string) => passageSwitchRef.current(id), [])

  // Navigate to prev/next passage
  const navigatePrev = useCallback(() => {
    if (prevFragment) handlePassageSwitch(prevFragment.id)
  }, [prevFragment, handlePassageSwitch])

  const navigateNext = useCallback(() => {
    if (nextFragment) handlePassageSwitch(nextFragment.id)
  }, [nextFragment, handlePassageSwitch])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'Escape' && !isTransformingSelection) {
        e.preventDefault()
        if (dirtyRef.current && editor && currentFragment) {
          const content = getEditorText()
          if (content !== currentFragment.content) {
            savingFragmentRef.current = fragmentId
            updateMutation.mutate({ fId: fragmentId, content })
          }
        }
        onClose()
      }
      // Alt+Up/Down for passage navigation
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        navigatePrev()
      }
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        navigateNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave, isTransformingSelection, onClose, editor, currentFragment, fragmentId, getEditorText, updateMutation, navigatePrev, navigateNext])

  // Scroll active sidebar item into view
  useEffect(() => {
    const el = sidebarScrollRef.current?.querySelector(`[data-passage-id="${fragmentId}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [fragmentId])

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      if (transformUndoTimerRef.current) clearTimeout(transformUndoTimerRef.current)
    }
  }, [])

  // Selection transform
  const applySelectionTransform = async (mode: SelectionTransformMode, instruction?: string, label?: string) => {
    if (!editor || isTransformingSelection) return
    const { from, to, empty } = editor.state.selection
    if (empty || to <= from) return

    const selectedText = editor.state.doc.textBetween(from, to, '\n')
    if (!selectedText.trim()) return

    setIsTransformingSelection(true)
    setSelectionTransformMode(mode)
    setSelectionTransformReasoning('')
    setCustomTransformLabel(label ?? null)
    setShowTransformUndo(false)

    try {
      const contextBefore = editor.state.doc.textBetween(Math.max(0, from - 240), from, '\n')
      const contextAfter = editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + 240), '\n')

      const stream = await api.librarian.transformProseSelection(
        storyId,
        fragmentId,
        mode,
        selectedText,
        {
          sourceContent: editor.getText({ blockSeparator: '\n\n' }),
          contextBefore,
          contextAfter,
          instruction,
        },
      )

      const reader = stream.getReader()
      let transformed = ''
      let reasoning = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'text') transformed += value.text
        if (value.type === 'reasoning') {
          reasoning += value.text
          setSelectionTransformReasoning(reasoning)
        }
      }

      const compact = transformed.trim()
      if (!compact) return

      const leadingWhitespace = selectedText.match(/^\s*/)?.[0] ?? ''
      const trailingWhitespace = selectedText.match(/\s*$/)?.[0] ?? ''
      const replacement = `${leadingWhitespace}${compact}${trailingWhitespace}`

      editor.chain().focus().insertContentAt({ from, to }, replacement).setTextSelection({ from, to: from + replacement.length }).run()
      dirtyRef.current = true
      setSaveState('idle')

      // Show undo hint after transform
      setShowTransformUndo(true)
      if (transformUndoTimerRef.current) clearTimeout(transformUndoTimerRef.current)
      transformUndoTimerRef.current = setTimeout(() => setShowTransformUndo(false), 6000)
    } finally {
      setIsTransformingSelection(false)
      setSelectionTransformMode(null)
      setCustomTransformLabel(null)
    }
  }

  // Editor stats
  const [editorStats, setEditorStats] = useState({ chars: 0, words: 0, tokens: 0, paragraphs: 0 })
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const text = editor.getText({ blockSeparator: '\n\n' })
      const chars = text.length
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      const tokens = Math.ceil(chars / 4)
      const paragraphs = text.trim() ? text.trim().split(/\n\n+/).length : 0
      setEditorStats({ chars, words, tokens, paragraphs })
    }
    update()
    editor.on('update', update)
    return () => { editor.off('update', update) }
  }, [editor, fragmentId])

  // Context strip helper — truncate to last ~120 chars of content
  const contextTail = (content: string) => {
    const clean = content.replace(/\n+/g, ' ').trim()
    if (clean.length <= 150) return clean
    return '\u2026' + clean.slice(-140)
  }
  const contextHead = (content: string) => {
    const clean = content.replace(/\n+/g, ' ').trim()
    if (clean.length <= 150) return clean
    return clean.slice(0, 140) + '\u2026'
  }

  // Pre-compute prose numbers so sidebar items can be memoized
  const proseNumberMap = useMemo(() => {
    const map = new Map<string, number>()
    let counter = 0
    for (const f of orderedItems) {
      if (f.type !== 'marker') {
        counter++
        map.set(f.id, counter)
      }
    }
    return map
  }, [orderedItems])

  const isDirty = dirtyRef.current

  return (
    <div className="flex h-full" data-component-id="prose-writing-panel">
      {/* Editor area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5 sm:px-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Wand2 className="size-4 text-primary/60 shrink-0" />
            {currentFragment?.description ? (
              <span className="font-display italic text-sm text-muted-foreground truncate max-w-[40ch]">
                {currentFragment.description}
              </span>
            ) : (
              <span className="font-display text-sm text-muted-foreground">
                Writing Panel
              </span>
            )}
            <SaveIndicator saveState={saveState} isDirty={isDirty} />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Passage navigation */}
            <div className="hidden sm:flex items-center gap-0.5 mr-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'size-7 flex items-center justify-center rounded-md transition-colors',
                      prevFragment
                        ? 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                        : 'text-muted-foreground cursor-default',
                    )}
                    onClick={navigatePrev}
                    disabled={!prevFragment}
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {prevFragment ? 'Previous passage (Alt+\u2191)' : 'First passage'}
                </TooltipContent>
              </Tooltip>
              <span className="text-[0.625rem] font-mono text-muted-foreground tabular-nums min-w-[2.5ch] text-center">
                {currentProseIndex + 1}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'size-7 flex items-center justify-center rounded-md transition-colors',
                      nextFragment
                        ? 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                        : 'text-muted-foreground cursor-default',
                    )}
                    onClick={navigateNext}
                    disabled={!nextFragment}
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {nextFragment ? 'Next passage (Alt+\u2193)' : 'Last passage'}
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Sidebar toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="hidden sm:flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                  onClick={() => setSidebarCollapsed(v => !v)}
                >
                  {sidebarCollapsed ? <PanelRightOpen className="size-3.5" /> : <PanelRightClose className="size-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {sidebarCollapsed ? 'Show passages' : 'Hide passages'}
              </TooltipContent>
            </Tooltip>

            <div className="w-px h-4 bg-border/30 mx-1" />

            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={handleSave}
              disabled={saveState === 'saving' || isTransformingSelection || !editor}
            >
              Ctrl+S
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="size-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (dirtyRef.current && editor && currentFragment) {
                  const content = getEditorText()
                  if (content !== currentFragment.content) {
                    savingFragmentRef.current = fragmentId
                    updateMutation.mutate({ fId: fragmentId, content })
                  }
                }
                onClose()
              }}
              disabled={isTransformingSelection}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Editor with context strips */}
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {/* Floating selection toolbar */}
          <FloatingElement
            editor={editor}
            shouldShow={hasSelection || isTransformingSelection}
            placement="top"
            offsetValue={8}
          >
            <div className="rounded-xl border border-border/60 bg-popover/95 shadow-2xl backdrop-blur-md w-[min(34rem,calc(100vw-2rem))]">
              {/* Primary transforms */}
              <div className="flex items-center gap-0.5 p-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs gap-1.5"
                  onClick={() => applySelectionTransform('rewrite')}
                  disabled={isTransformingSelection || !hasSelection}
                >
                  {isTransformingSelection && selectionTransformMode === 'rewrite' ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  Rewrite
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs gap-1.5"
                  onClick={() => applySelectionTransform('expand')}
                  disabled={isTransformingSelection || !hasSelection}
                >
                  {isTransformingSelection && selectionTransformMode === 'expand' ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
                  Expand
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs gap-1.5"
                  onClick={() => applySelectionTransform('compress')}
                  disabled={isTransformingSelection || !hasSelection}
                >
                  {isTransformingSelection && selectionTransformMode === 'compress' ? <Loader2 className="size-3 animate-spin" /> : <Minimize2 className="size-3" />}
                  Compress
                </Button>
                {showTransformUndo && !isTransformingSelection && (
                  <div className="flex items-center ml-auto pl-1 border-l border-border/30">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[0.625rem] gap-1 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        editor?.commands.undo()
                        setShowTransformUndo(false)
                      }}
                    >
                      <Undo2 className="size-2.5" />
                      Undo
                    </Button>
                  </div>
                )}
              </div>
              {/* Custom transforms */}
              {enabledTransforms.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5 border-t border-border/30 pt-1.5">
                  {enabledTransforms.map(t => (
                    <Button
                      key={t.id}
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[0.625rem] text-muted-foreground hover:text-foreground/80"
                      onClick={() => applySelectionTransform('custom', t.instruction, t.label)}
                      disabled={isTransformingSelection || !hasSelection}
                    >
                      {isTransformingSelection && selectionTransformMode === 'custom' && customTransformLabel === t.label
                        ? <Loader2 className="size-2.5 animate-spin mr-1" />
                        : null}
                      {t.label}
                    </Button>
                  ))}
                </div>
              )}
              {/* Reasoning stream */}
              {(isTransformingSelection || selectionTransformReasoning.trim()) && (
                <div className="border-t border-border/50 px-2.5 py-2">
                  <p className="mb-1 text-[0.625rem] uppercase tracking-wide text-muted-foreground">Reasoning</p>
                  <div className="max-h-36 overflow-y-auto overscroll-contain pr-1">
                    <p className="text-[0.6875rem] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                      {selectionTransformReasoning.trim() || 'Thinking\u2026'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </FloatingElement>

          {/* Previous passage context strip */}
          {prevFragment && (
            <button
              className="group/ctx w-full text-left px-6 sm:px-10 md:px-16 pt-4 pb-2"
              onClick={navigatePrev}
            >
              <div className="flex items-center gap-2 mb-1">
                <ChevronUp className="size-3 text-muted-foreground group-hover/ctx:text-muted-foreground transition-colors" />
                <span className="text-[0.625rem] text-muted-foreground group-hover/ctx:text-muted-foreground transition-colors">
                  Previous passage
                </span>
              </div>
              <p className="font-prose text-sm leading-relaxed text-muted-foreground group-hover/ctx:text-muted-foreground transition-colors line-clamp-2">
                {contextTail(prevFragment.content)}
              </p>
              <div className="mt-2 h-px bg-gradient-to-r from-transparent via-border/30 to-transparent" />
            </button>
          )}

          {/* Tiptap editor */}
          <EditorContent editor={editor} className="min-h-[60vh]" />

          {/* Next passage context strip */}
          {nextFragment && (
            <button
              className="group/ctx w-full text-left px-6 sm:px-10 md:px-16 pt-2 pb-4"
              onClick={navigateNext}
            >
              <div className="mb-1 h-px bg-gradient-to-r from-transparent via-border/30 to-transparent" />
              <p className="mt-2 font-prose text-sm leading-relaxed text-muted-foreground group-hover/ctx:text-muted-foreground transition-colors line-clamp-2">
                {contextHead(nextFragment.content)}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <ChevronDown className="size-3 text-muted-foreground group-hover/ctx:text-muted-foreground transition-colors" />
                <span className="text-[0.625rem] text-muted-foreground group-hover/ctx:text-muted-foreground transition-colors">
                  Next passage
                </span>
              </div>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border/30 px-4 py-2 sm:px-6 flex items-center justify-between gap-4">
          <span className="text-[0.625rem] text-muted-foreground hidden sm:inline">
            Ctrl+S save &middot; Esc close &middot; Alt+&uarr;&darr; passages
          </span>
          <span className="text-[0.625rem] text-muted-foreground sm:hidden">
            Ctrl+S &middot; Esc
          </span>
          <span className="text-[0.625rem] text-muted-foreground font-mono tabular-nums">
            {editorStats.words.toLocaleString()}w
            &middot; {editorStats.chars.toLocaleString()}c
            &middot; ~{editorStats.tokens.toLocaleString()}t
            &middot; {editorStats.paragraphs}&para;
            &middot; {readingTime(editorStats.words)} read
          </span>
        </div>
      </div>

      {/* Passage sidebar — right side */}
      <div
        className={cn(
          'hidden sm:flex shrink-0 flex-col border-l border-border/40 bg-background/95 transition-[width] duration-200 ease-out overflow-hidden',
          sidebarCollapsed ? 'w-0 border-l-0' : 'w-60',
        )}
      >
        {/* Sidebar header with search */}
        <div className="shrink-0 px-3 pt-4 pb-2">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground font-medium">
              Passages
            </h3>
            <span className="text-[0.625rem] font-mono text-muted-foreground tabular-nums">
              {proseItems.length}
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="Filter"
              className="w-full bg-muted/30 hover:bg-muted/50 focus:bg-muted/50 border border-transparent focus:border-border/40 rounded-md pl-7 pr-2 py-1.5 text-[0.6875rem] text-foreground placeholder:text-muted-foreground outline-none transition-all"
            />
            {sidebarSearch && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 size-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setSidebarSearch('')}
              >
                <X className="size-2.5" />
              </button>
            )}
          </div>
        </div>

        <ScrollArea ref={sidebarScrollRef} className="flex-1 min-h-0">
          <div className="px-1.5 pb-2">
            {filteredItems.map((fragment) => {
              if (fragment.type === 'marker') {
                return (
                  <div
                    key={fragment.id}
                    className="w-full text-left px-2 py-1.5 mt-3 mb-0.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="h-px flex-1 bg-amber-500/10" />
                      <Bookmark className="size-2.5 text-amber-500/40 shrink-0" />
                      <span className="text-[0.625rem] font-medium tracking-wide text-amber-500/40 shrink-0">
                        {fragment.name}
                      </span>
                      <div className="h-px flex-1 bg-amber-500/10" />
                    </div>
                  </div>
                )
              }

              return (
                <PassageItem
                  key={fragment.id}
                  fragment={fragment}
                  isActive={fragment.id === fragmentId}
                  proseNumber={proseNumberMap.get(fragment.id) ?? 0}
                  onSwitch={stablePassageSwitch}
                />
              )
            })}

            {sidebarSearch && filteredItems.length === 0 && (
              <p className="text-[0.6875rem] text-muted-foreground text-center py-6 italic">
                No matches
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
