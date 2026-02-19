import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { api, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FloatingElement } from '@/components/tiptap/FloatingElement'
import {
  Loader2,
  Sparkles,
  Wand2,
  Minimize2,
  X,
  Save,
  Bookmark,
} from 'lucide-react'

type SelectionTransformMode = 'rewrite' | 'expand' | 'compress'

interface ProseWritingPanelProps {
  storyId: string
  fragmentId: string
  onClose: () => void
  onFragmentChange: (id: string) => void
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function plainTextToHtml(content: string): string {
  if (!content.trim()) return '<p></p>'
  return content
    .split('\n\n')
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br />')}</p>`)
    .join('')
}

export function ProseWritingPanel({
  storyId,
  fragmentId,
  onClose,
  onFragmentChange,
}: ProseWritingPanelProps) {
  const queryClient = useQueryClient()
  const [isTransformingSelection, setIsTransformingSelection] = useState(false)
  const [selectionTransformMode, setSelectionTransformMode] = useState<SelectionTransformMode | null>(null)
  const [selectionTransformReasoning, setSelectionTransformReasoning] = useState('')
  const activeItemRef = useRef<HTMLButtonElement>(null)
  const sidebarScrollRef = useRef<HTMLDivElement>(null)
  const dirtyRef = useRef(false)
  const savingFragmentRef = useRef<string | null>(null)

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

  // Current fragment
  const currentFragment = allFragmentsMap.get(fragmentId)

  // Save mutation
  const updateMutation = useMutation({
    mutationFn: ({ fId, content }: { fId: string; content: string }) => {
      const frag = allFragmentsMap.get(fId)
      return api.fragments.update(storyId, fId, {
        name: frag?.name ?? '',
        description: frag?.description ?? '',
        content,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      dirtyRef.current = false
      savingFragmentRef.current = null
    },
    onError: () => {
      savingFragmentRef.current = null
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
      }),
    ],
    content: plainTextToHtml(currentFragment?.content ?? ''),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose-content font-prose max-w-none min-h-[60vh] px-6 sm:px-10 py-6 sm:py-8 focus:outline-none',
      },
    },
    onUpdate: () => {
      dirtyRef.current = true
    },
  })

  // Sync editor content when the active fragment changes
  useEffect(() => {
    if (!editor || !currentFragment) return
    // Don't overwrite if we're currently saving this fragment
    if (savingFragmentRef.current === fragmentId) return
    editor.commands.setContent(plainTextToHtml(currentFragment.content), { emitUpdate: false })
    dirtyRef.current = false
    setSelectionTransformReasoning('')
    setSelectionTransformMode(null)
    setIsTransformingSelection(false)
  }, [editor, fragmentId, currentFragment?.content])

  // Track selection reactively via editor events (ProseMirror state
  // changes don't trigger React re-renders on their own)
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
    if (!editor || isTransformingSelection || updateMutation.isPending) return
    const content = getEditorText()
    if (!currentFragment || content === currentFragment.content) {
      dirtyRef.current = false
      return
    }
    savingFragmentRef.current = fragmentId
    updateMutation.mutate({ fId: fragmentId, content })
  }, [editor, isTransformingSelection, updateMutation, getEditorText, currentFragment, fragmentId])

  // Auto-save if dirty, then switch to a different passage
  const handlePassageSwitch = useCallback((targetId: string) => {
    if (targetId === fragmentId) return
    // Auto-save if dirty
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'Escape' && !isTransformingSelection) {
        e.preventDefault()
        // Auto-save on Esc close
        if (dirtyRef.current && editor && currentFragment) {
          const content = getEditorText()
          if (content !== currentFragment.content) {
            savingFragmentRef.current = fragmentId
            updateMutation.mutate({ fId: fragmentId, content })
          }
        }
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave, isTransformingSelection, onClose, editor, currentFragment, fragmentId, getEditorText, updateMutation])

  // Scroll active sidebar item into view
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [fragmentId])

  // Selection transform (rewrite/expand/compress)
  const applySelectionTransform = async (mode: SelectionTransformMode) => {
    if (!editor || isTransformingSelection) return
    const { from, to, empty } = editor.state.selection
    if (empty || to <= from) return

    const selectedText = editor.state.doc.textBetween(from, to, '\n')
    if (!selectedText.trim()) return

    setIsTransformingSelection(true)
    setSelectionTransformMode(mode)
    setSelectionTransformReasoning('')

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
    } finally {
      setIsTransformingSelection(false)
      setSelectionTransformMode(null)
    }
  }

  // Sidebar helpers
  const preview = (content: string) => {
    const line = content.replace(/\n+/g, ' ').trim()
    return line.length > 60 ? line.slice(0, 60) + '...' : line
  }

  let proseCounter = 0

  return (
    <div className="flex h-full" data-component-id="prose-writing-panel">
      {/* Editor area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3 sm:px-6 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Wand2 className="size-4 text-primary/80 shrink-0" />
            {currentFragment?.description ? (
              <span className="font-display italic text-sm text-muted-foreground/60 truncate">
                {currentFragment.description}
              </span>
            ) : (
              <span className="font-display text-sm text-muted-foreground/30">
                Writing Panel
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSave}
              disabled={updateMutation.isPending || isTransformingSelection || !editor}
            >
              <Save className="size-3.5 mr-1.5" />
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // Auto-save on close
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

        {/* Editor */}
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <FloatingElement
            editor={editor}
            shouldShow={hasSelection || isTransformingSelection}
            placement="top"
            offsetValue={8}
          >
            <div className="rounded-xl border border-border/60 bg-popover/95 shadow-2xl backdrop-blur-md w-[min(34rem,calc(100vw-2rem))]">
              <div className="flex items-center gap-1 p-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => applySelectionTransform('rewrite')}
                  disabled={isTransformingSelection || !hasSelection}
                >
                  {isTransformingSelection && selectionTransformMode === 'rewrite' ? <Loader2 className="size-3 animate-spin mr-1" /> : <Sparkles className="size-3 mr-1" />}
                  Rewrite
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => applySelectionTransform('expand')}
                  disabled={isTransformingSelection || !hasSelection}
                >
                  {isTransformingSelection && selectionTransformMode === 'expand' ? <Loader2 className="size-3 animate-spin mr-1" /> : <Wand2 className="size-3 mr-1" />}
                  Expand
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => applySelectionTransform('compress')}
                  disabled={isTransformingSelection || !hasSelection}
                >
                  {isTransformingSelection && selectionTransformMode === 'compress' ? <Loader2 className="size-3 animate-spin mr-1" /> : <Minimize2 className="size-3 mr-1" />}
                  Compress
                </Button>
              </div>
              {(isTransformingSelection || selectionTransformReasoning.trim()) && (
                <div className="border-t border-border/50 px-2.5 py-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">Reasoning</p>
                  <div className="max-h-36 overflow-y-auto overscroll-contain pr-1">
                    <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                      {selectionTransformReasoning.trim() || 'Thinking...'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </FloatingElement>

          <EditorContent editor={editor} className="h-full" />
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border/30 px-4 py-2 sm:px-6">
          <span className="text-[10px] text-muted-foreground/30">
            Ctrl+S save &middot; Esc close
          </span>
        </div>
      </div>

      {/* Passage sidebar — right side */}
      <div className="hidden sm:flex w-56 shrink-0 flex-col border-l border-border/40 bg-background/95">
        <div className="shrink-0 px-4 pt-5 pb-3">
          <h3 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40 font-medium">
            Passages
          </h3>
        </div>

        <ScrollArea ref={sidebarScrollRef} className="flex-1 min-h-0">
          <div className="px-2 pb-2">
            {orderedItems.map((fragment) => {
              const isActive = fragment.id === fragmentId
              const isMarker = fragment.type === 'marker'

              if (isMarker) {
                return (
                  <div
                    key={fragment.id}
                    className="w-full text-left rounded-md px-2.5 py-2 mt-2 mb-0.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <Bookmark className="size-2.5 text-amber-500/50 shrink-0" />
                      <span className="text-[10px] font-medium tracking-wide truncate text-amber-500/40">
                        {fragment.name}
                      </span>
                    </div>
                  </div>
                )
              }

              proseCounter++
              const currentProseNumber = proseCounter

              return (
                <button
                  key={fragment.id}
                  ref={isActive ? activeItemRef : undefined}
                  onClick={() => handlePassageSwitch(fragment.id)}
                  className={`w-full text-left rounded-md px-2.5 py-2 mb-0.5 transition-colors duration-100 group/item ${
                    isActive
                      ? 'bg-accent/70'
                      : 'hover:bg-accent/40'
                  }`}
                >
                  <span className={`block text-[10px] font-mono mb-0.5 ${
                    isActive ? 'text-primary/70' : 'text-muted-foreground/25'
                  }`}>
                    {currentProseNumber}
                  </span>
                  {fragment.description && (
                    <span className={`block text-[10px] italic truncate mb-0.5 ${
                      isActive
                        ? 'text-muted-foreground/70'
                        : 'text-muted-foreground/40 group-hover/item:text-muted-foreground/60'
                    }`}>
                      {fragment.description.slice(0, 50)}{fragment.description.length > 50 ? '...' : ''}
                    </span>
                  )}
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
        </ScrollArea>
      </div>
    </div>
  )
}
