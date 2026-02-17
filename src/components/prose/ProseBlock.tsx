import { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment, type ProseChainEntry } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { StreamMarkdown } from '@/components/ui/stream-markdown'
import { ChevronRail } from './ChevronRail'
import { GenerationThoughts } from './GenerationThoughts'
import { type ThoughtStep } from './InlineGenerationInput'
import { buildAnnotationHighlighter, type Annotation } from '@/lib/character-mentions'
import { RefreshCw, Sparkles, Undo2, PenLine, Bug, Trash2 } from 'lucide-react'

interface ProseBlockProps {
  storyId: string
  fragment: Fragment
  displayIndex: number
  sectionIndex: number
  chainEntry: ProseChainEntry | null
  isLast: boolean
  isFirst?: boolean
  onSelect: () => void
  onDebugLog?: (logId: string) => void
  quickSwitch: boolean
  mentionsEnabled?: boolean
  mentionColors?: Map<string, string>
  onClickMention?: (fragmentId: string) => void
}

export function ProseBlock({
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
  mentionsEnabled,
  mentionColors,
  onClickMention,
}: ProseBlockProps) {
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
  const [actionThoughtSteps, setActionThoughtSteps] = useState<ThoughtStep[]>([])
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
    setActionThoughtSteps([])

    try {
      const stream = await api.generation.regenerate(storyId, fragment.id, quickRegenerateInput)
      const reader = stream.getReader()
      let accumulated = ''
      let accumulatedReasoning = ''
      const steps: ThoughtStep[] = []
      let stepsDirty = false
      let rafScheduled = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'text') {
          accumulated += value.text
        } else if (value.type === 'reasoning') {
          accumulatedReasoning += value.text
          const last = steps[steps.length - 1]
          if (last && last.type === 'reasoning') {
            last.text = accumulatedReasoning
          } else {
            steps.push({ type: 'reasoning', text: accumulatedReasoning })
          }
          stepsDirty = true
        } else if (value.type === 'tool-call') {
          accumulatedReasoning = ''
          steps.push({ type: 'tool-call', id: value.id, toolName: value.toolName, args: value.args })
          stepsDirty = true
        } else if (value.type === 'tool-result') {
          steps.push({ type: 'tool-result', id: value.id, toolName: value.toolName, result: value.result })
          stepsDirty = true
        }
        if (!rafScheduled) {
          rafScheduled = true
          const snapshot = accumulated
          const stepsSnapshot = stepsDirty ? [...steps] : null
          stepsDirty = false
          requestAnimationFrame(() => {
            setStreamedActionText(snapshot)
            if (stepsSnapshot) setActionThoughtSteps(stepsSnapshot)
            rafScheduled = false
          })
        }
      }

      setStreamedActionText(accumulated)
      if (steps.length > 0) setActionThoughtSteps([...steps])
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      handleActionComplete()
    } catch {
      setIsStreamingAction(false)
      setStreamedActionText('')
      setActionThoughtSteps([])
    }
  }

  const handleActionSubmit = async () => {
    if (!actionInput.trim() || isStreamingAction) return

    const mode = actionMode
    setActionMode(null)
    setShowActions(false)
    setIsStreamingAction(true)
    setStreamedActionText('')
    setActionThoughtSteps([])

    try {
      const stream = mode === 'refine'
        ? await api.generation.refine(storyId, fragment.id, actionInput)
        : await api.generation.regenerate(storyId, fragment.id, actionInput)

      const reader = stream.getReader()
      let accumulated = ''
      let accumulatedReasoning = ''
      const steps: ThoughtStep[] = []
      let stepsDirty = false
      let rafScheduled = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'text') {
          accumulated += value.text
        } else if (value.type === 'reasoning') {
          accumulatedReasoning += value.text
          const last = steps[steps.length - 1]
          if (last && last.type === 'reasoning') {
            last.text = accumulatedReasoning
          } else {
            steps.push({ type: 'reasoning', text: accumulatedReasoning })
          }
          stepsDirty = true
        } else if (value.type === 'tool-call') {
          accumulatedReasoning = ''
          steps.push({ type: 'tool-call', id: value.id, toolName: value.toolName, args: value.args })
          stepsDirty = true
        } else if (value.type === 'tool-result') {
          steps.push({ type: 'tool-result', id: value.id, toolName: value.toolName, result: value.result })
          stepsDirty = true
        }
        if (!rafScheduled) {
          rafScheduled = true
          const snapshot = accumulated
          const stepsSnapshot = stepsDirty ? [...steps] : null
          stepsDirty = false
          requestAnimationFrame(() => {
            setStreamedActionText(snapshot)
            if (stepsSnapshot) setActionThoughtSteps(stepsSnapshot)
            rafScheduled = false
          })
        }
      }

      setStreamedActionText(accumulated)
      if (steps.length > 0) setActionThoughtSteps([...steps])
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      handleActionComplete()
    } catch {
      setIsStreamingAction(false)
      setStreamedActionText('')
      setActionThoughtSteps([])
    }
  }

  const handleActionComplete = () => {
    setActionMode(null)
    setIsStreamingAction(false)
    setStreamedActionText('')
    setActionThoughtSteps([])
    setShowUndo(true)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setShowUndo(false), 10000)
  }

  // Build mention highlighter from annotations
  const annotations = fragment.meta?.annotations as Annotation[] | undefined
  const textTransform = useMemo(() => {
    if (!mentionsEnabled || !annotations || !onClickMention) return undefined
    return buildAnnotationHighlighter(annotations, onClickMention, mentionColors) ?? undefined
  }, [mentionsEnabled, annotations, onClickMention, mentionColors])

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
          <span className="text-[10px] text-muted-foreground/30 italic">{fragment.description}</span>
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
        {(isStreamingAction || streamedActionText) && actionThoughtSteps.length > 0 && (
          <GenerationThoughts
            steps={actionThoughtSteps}
            streaming={isStreamingAction}
            hasText={!!streamedActionText}
          />
        )}
        <StreamMarkdown
          content={(isStreamingAction || streamedActionText)
            ? streamedActionText || ''
            : fragment.content
          }
          streaming={isStreamingAction}
          variant="prose"
          textTransform={!isStreamingAction && !streamedActionText ? textTransform : undefined}
        />

      </div>

      {/* Action panel — sticky to bottom of scroll area, contained to prose column */}
      {(showActions || actionMode) && !isStreamingAction && (
        <div className="sticky bottom-4 z-10 flex justify-center py-2 animate-in fade-in slide-in-from-bottom-2 duration-200" data-component-id="prose-block-actions">
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
              <div className="inline-flex items-center gap-0.5 px-1.5 py-1 overflow-x-auto max-w-[calc(100vw-3rem)]">
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
