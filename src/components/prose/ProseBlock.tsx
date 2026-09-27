import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { useIsCoarsePointer } from '@/hooks/use-mobile'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment, type ProseChainEntry } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { StreamMarkdown } from '@/components/ui/stream-markdown'
import { ChevronRail } from './ChevronRail'
import { ProseImageHeader } from './ProseImageHeader'
import { resolveHeaderImage } from '@/lib/fragment-visuals'
import { GenerationThoughts } from './GenerationThoughts'
import { ProseInlineEditor } from './ProseInlineEditor'
import { anchorFromPoint, resolveCaretOffset } from '@/lib/prose-caret'
import { type ThoughtStep } from './InlineGenerationInput'
import { buildAnnotationHighlighter, formatDialogue, composeTextTransforms, stripEmphasisInDialogue, type Annotation } from '@/lib/character-mentions'
import { RefreshCw, Undo2, PenLine, Bug, Trash2, GitBranch, MessageSquare, ChevronDown, ChevronLeft, ChevronRight, Info, BookOpen, Volume2, Square } from 'lucide-react'
import { Caption } from '@/components/ui/prose-text'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useTtsSettings, useIsReadingFragment, playFragment, stopTts, resolveReadAloudText } from '@/lib/tts'

interface ProseBlockProps {
  storyId: string
  fragment: Fragment
  displayIndex: number
  sectionIndex: number
  chainEntry: ProseChainEntry | null
  isLast: boolean
  isFirst?: boolean
  onSelect: (fragment: Fragment) => void
  onDebugLog?: (logId: string) => void
  onBranchFrom?: (sectionIndex: number) => void
  onEdit?: (fragmentId: string, selectedText?: string) => void
  onAskLibrarian?: (fragmentId: string, prefill?: string) => void
  onAnalyze?: (fragmentId: string) => void
  hasAnalysis?: boolean
  quickSwitch: boolean
  mentionsEnabled?: boolean
  mentionColors?: Map<string, string>
  onClickMention?: (fragmentId: string) => void
  mediaById?: Map<string, Fragment>
}

/** Gap between the click point and the toolbar edge, so the cursor never sits on it. */
const TOOLBAR_GAP = 12
/** Below this offset there's no room above the click, so the toolbar opens beneath it. */
const TOOLBAR_CLEARANCE = 120

/**
 * The toolbar sits just above the click point (never on top of it) so a second
 * click lands on the prose again — double-click still opens the inline editor.
 */
export function toolbarPlacement(clickY: number): React.CSSProperties {
  if (clickY > TOOLBAR_CLEARANCE) return { top: clickY - TOOLBAR_GAP, transform: 'translateY(-100%)' }
  return { top: clickY + TOOLBAR_GAP }
}

/** Isolated sub-component so query cache subscriptions don't force ProseBlock re-renders */
function ProviderQuickSwitch({
  storyId,
  isStreamingAction,
}: {
  storyId: string
  isStreamingAction: boolean
}) {
  const queryClient = useQueryClient()
  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })
  const { data: globalConfig } = useQuery({
    queryKey: ['global-config'],
    queryFn: () => api.config.getProviders(),
  })
  const providerMutation = useMutation({
    mutationFn: (data: { providerId: string | null; modelId: string | null }) => {
      const overrides = story?.settings.modelOverrides ?? {}
      return api.settings.update(storyId, {
        modelOverrides: { ...overrides, generation: { providerId: data.providerId, modelId: data.modelId } },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
    },
  })

  if (!globalConfig) return null

  const providers = globalConfig.providers.filter(p => p.enabled)
  const defaultProvider = globalConfig.defaultProviderId
    ? providers.find(p => p.id === globalConfig.defaultProviderId)
    : null

  return (
    <select
      value={story?.settings.modelOverrides?.generation?.providerId ?? ''}
      onChange={(e) => {
        const providerId = e.target.value || null
        providerMutation.mutate({ providerId, modelId: null })
      }}
      disabled={providerMutation.isPending || isStreamingAction}
      className="text-[0.625rem] text-muted-foreground bg-transparent hover:bg-muted/40 border border-border/30 hover:border-border/50 rounded outline-none cursor-pointer transition-all appearance-none pl-1.5 pr-4 py-0.5 font-mono max-w-[140px] truncate disabled:opacity-30 focus:ring-1 focus:ring-primary/20"
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='7' height='7' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center' }}
    >
      <option value="">
        {defaultProvider ? defaultProvider.defaultModel : 'No provider'}
      </option>
      {providers
        .filter(p => p.id !== globalConfig.defaultProviderId)
        .map(p => (
          <option key={p.id} value={p.id}>{p.defaultModel}</option>
        ))}
    </select>
  )
}

export const ProseBlock = memo(function ProseBlock({
  storyId,
  fragment,
  displayIndex,
  sectionIndex,
  chainEntry,
  isLast,
  isFirst,
  onSelect,
  onEdit,
  onDebugLog,
  onBranchFrom,
  onAskLibrarian,
  onAnalyze,
  hasAnalysis,
  quickSwitch,
  mentionsEnabled,
  mentionColors,
  onClickMention,
  mediaById,
}: ProseBlockProps) {
  // isFirst/isLast are part of the interface for future use
  void isFirst
  void isLast
  const queryClient = useQueryClient()
  // select keeps this subscription from re-rendering the memo'd block on unrelated story-cache updates
  const { data: expandThoughtsByDefault } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
    select: (s) => s.settings.expandThoughtsByDefault,
  })
  const confirm = useConfirm()
  const [actionMode, setActionMode] = useState<'regenerate' | null>(null)
  const [showUndo, setShowUndo] = useState(false)
  const [isStreamingAction, setIsStreamingAction] = useState(false)
  const [streamedActionText, setStreamedActionText] = useState('')
  const [actionThoughtSteps, setActionThoughtSteps] = useState<ThoughtStep[]>([])
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showActions, setShowActions] = useState(false)
  const [actionInput, setActionInput] = useState('')
  const [ttsSettings] = useTtsSettings()
  const isReadingThis = useIsReadingFragment(fragment.id)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  const [editCaret, setEditCaret] = useState(0)
  const [clickY, setClickY] = useState(0)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [promptOverflows, setPromptOverflows] = useState(false)
  const blockRef = useRef<HTMLDivElement>(null)
  // On touch the OS selection bar (Copy/Translate/…) is drawn above a selection,
  // right where the toolbar would float — so dock the toolbar to the bottom.
  const isCoarsePointer = useIsCoarsePointer()
  const actionPanelRef = useRef<HTMLDivElement>(null)
  const actionInputRef = useRef<HTMLTextAreaElement>(null)
  const promptInputRef = useRef<HTMLTextAreaElement>(null)
  const promptTextRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  // Auto-resize the inline prompt textarea (grow with content, then scroll)
  useEffect(() => {
    if (!editingPrompt) return
    const el = promptInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [actionInput, editingPrompt])

  // Detect whether the collapsed prompt line is clipped, to offer the expand toggle
  useEffect(() => {
    const el = promptTextRef.current
    if (!el) return
    const check = () => setPromptOverflows(el.scrollWidth > el.clientWidth + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [editingPrompt, promptExpanded, fragment.description, fragment.meta?.generatedFrom])

  // Dismiss action panel / prompt editor on outside click
  useEffect(() => {
    if (!showActions && !actionMode && !editingPrompt) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (actionPanelRef.current?.contains(target)) return
      if (blockRef.current && !blockRef.current.contains(target)) {
        setShowActions(false)
        setActionMode(null)
        setActionInput('')
        setEditingPrompt(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showActions, actionMode, editingPrompt])

  // Inline passage edit — double-click the prose to open, Ctrl+Enter to save
  const saveContentMutation = useMutation({
    mutationFn: (content: string) =>
      api.fragments.update(storyId, fragment.id, {
        name: fragment.name,
        description: fragment.description,
        content,
      }),
    onSuccess: () => {
      setEditingContent(false)
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
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

    setActionMode(null)
    setShowActions(false)
    setIsStreamingAction(true)
    setStreamedActionText('')
    setActionThoughtSteps([])

    try {
      const stream = await api.generation.regenerate(storyId, fragment.id, actionInput)

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
    setEditingPrompt(false)
    setIsStreamingAction(false)
    setStreamedActionText('')
    setActionThoughtSteps([])
    setShowUndo(true)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setShowUndo(false), 10000)
  }

  const handlePromptSubmit = async () => {
    if (!actionInput.trim() || isStreamingAction) return
    setEditingPrompt(false)
    setShowActions(false)
    setIsStreamingAction(true)
    setStreamedActionText('')
    setActionThoughtSteps([])

    try {
      const stream = await api.generation.regenerate(storyId, fragment.id, actionInput)
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

  // Pre-strip markdown emphasis from inside dialogue so markdown parsing
  // doesn't split quoted text across element boundaries.
  const processedContent = useMemo(() => stripEmphasisInDialogue(fragment.content), [fragment.content])

  // Build text transform: dialogue italics + optional mention highlighting
  const annotations = fragment.meta?.annotations as Annotation[] | undefined
  const textTransform = useMemo(() => {
    const mentionHighlighter = mentionsEnabled && annotations && onClickMention
      ? buildAnnotationHighlighter(annotations, onClickMention, mentionColors)
      : null
    if (mentionHighlighter) return composeTextTransforms(formatDialogue, mentionHighlighter)
    return formatDialogue
  }, [mentionsEnabled, annotations, onClickMention, mentionColors])

  // Resolve a linked image for the passage header (first image visual ref).
  const headerImage = useMemo(
    () => (mediaById ? resolveHeaderImage(fragment, mediaById) : null),
    [fragment, mediaById],
  )

  return (
    <div ref={blockRef} className="group relative mb-6" data-prose-index={displayIndex} data-component-id={`prose-${fragment.id}-block`}>
      {/* Analyzed indicator — subtle dot in the top-right corner */}
      {hasAnalysis && (
        <div className="absolute -top-1 -right-1 z-[1]" title="Analyzed by librarian">
          <div className="size-2 rounded-full bg-emerald-500/70 shadow-[0_0_4px_rgba(16,185,129,0.3)]" />
        </div>
      )}

      {/* Linked image — framed plate at the top of the passage */}
      {headerImage && (
        <ProseImageHeader storyId={storyId} fragment={fragment} header={headerImage} />
      )}

      {/* User prompt header — left-aligned accent bar, display font, inline editable */}
      {fragment.description && (
        <div className="mb-3 -mt-2">
          {editingPrompt ? (
            /* Inline editing — input replaces the header text in place */
            <div className="flex items-start gap-2.5">
              <div className="w-0.5 self-stretch rounded-full bg-primary/50 shrink-0" />
              <div className="flex-1 min-w-0">
                <textarea
                  ref={promptInputRef}
                  value={actionInput}
                  onChange={(e) => setActionInput(e.target.value)}
                  className="w-full resize-none bg-transparent font-display italic text-sm text-foreground/80 placeholder:text-muted-foreground outline-none border-none p-0 caret-primary"
                  placeholder="New direction..."
                  rows={1}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEditingPrompt(false)
                      setActionInput('')
                    }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      handlePromptSubmit()
                    }
                  }}
                />
                <div className="flex items-center gap-2 mt-1.5">
                  <ProviderQuickSwitch storyId={storyId} isStreamingAction={isStreamingAction} />
                  <span className="text-[0.625rem] text-muted-foreground">
                    Ctrl+Enter &middot; Esc
                  </span>
                  <button
                    className="ml-auto text-[0.625rem] px-1.5 py-0.5 rounded text-primary/70 hover:text-primary hover:bg-primary/10 transition-colors font-medium disabled:opacity-30"
                    disabled={!actionInput.trim()}
                    onClick={handlePromptSubmit}
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            </div>
          ) : canQuickRegenerate ? (
            <div className="flex min-h-6 items-start gap-2.5">
              <button
                className="group/prompt flex min-w-0 flex-1 items-start gap-2.5 text-left transition-all"
                onClick={(e) => {
                  e.stopPropagation()
                  setActionInput(generatedFrom || fragment.description || '')
                  setEditingPrompt(true)
                  requestAnimationFrame(() => {
                    promptInputRef.current?.focus()
                    promptInputRef.current?.select()
                  })
                }}
                title="Click to edit prompt and regenerate"
              >
                <div className={`w-0.5 rounded-full bg-primary/20 group-hover/prompt:bg-primary/45 transition-colors shrink-0 ${promptExpanded ? 'self-stretch' : 'min-h-[1.25rem] mt-0.5'}`} />
                <Caption asChild size="sm" className={`min-w-0 flex-1 font-display italic group-hover/prompt:text-muted-foreground transition-colors ${promptExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                  <span ref={promptTextRef}>{generatedFrom || fragment.description}</span>
                </Caption>
                <RefreshCw className="size-3 shrink-0 mt-1 opacity-0 group-hover/prompt:opacity-40 transition-opacity" />
              </button>
              {(promptOverflows || promptExpanded) && (
                <button
                  className="shrink-0 mt-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  onClick={(e) => { e.stopPropagation(); setPromptExpanded(v => !v) }}
                  title={promptExpanded ? 'Collapse prompt' : 'Show full prompt'}
                  aria-label={promptExpanded ? 'Collapse prompt' : 'Show full prompt'}
                  aria-expanded={promptExpanded}
                >
                  <ChevronDown className={`size-3 transition-transform duration-150 ${promptExpanded ? 'rotate-180' : ''}`} />
                </button>
              )}
              {hasMultiple && (
                <span className="text-[0.625rem] font-mono text-muted-foreground shrink-0 mt-0.5">{variationIndex + 1}/{variationCount}</span>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2.5">
              <div className={`w-0.5 rounded-full bg-border/30 shrink-0 ${promptExpanded ? 'self-stretch' : 'min-h-[1.25rem] mt-0.5'}`} />
              <Caption asChild size="sm" className={`min-w-0 flex-1 font-display italic ${promptExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                <span ref={promptTextRef}>{fragment.description}</span>
              </Caption>
              {(promptOverflows || promptExpanded) && (
                <button
                  className="shrink-0 mt-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  onClick={(e) => { e.stopPropagation(); setPromptExpanded(v => !v) }}
                  title={promptExpanded ? 'Collapse prompt' : 'Show full prompt'}
                  aria-label={promptExpanded ? 'Collapse prompt' : 'Show full prompt'}
                  aria-expanded={promptExpanded}
                >
                  <ChevronDown className={`size-3 transition-transform duration-150 ${promptExpanded ? 'rotate-180' : ''}`} />
                </button>
              )}
              {hasMultiple && (
                <span className="text-[0.625rem] font-mono text-muted-foreground shrink-0 mt-0.5">{variationIndex + 1}/{variationCount}</span>
              )}
            </div>
          )}
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

      {editingContent ? (
        <ProseInlineEditor
          content={fragment.content}
          initialCaret={editCaret}
          saving={saveContentMutation.isPending}
          onSave={(content) => saveContentMutation.mutate(content)}
          onCancel={() => { if (!saveContentMutation.isPending) setEditingContent(false) }}
        />
      ) : (
      <div
        role="button"
        tabIndex={0}
        onClick={(e: React.MouseEvent) => {
          if (isStreamingAction) return
          if (!showActions && blockRef.current) {
            const blockRect = blockRef.current.getBoundingClientRect()
            setClickY(e.clientY - blockRect.top)
          }
          setShowActions(v => !v)
        }}
        onDoubleClick={(e: React.MouseEvent<HTMLDivElement>) => {
          if (isStreamingAction) return
          // Place the caret on the word under the pointer, and clear the
          // word selection the double-click left behind.
          const anchor = anchorFromPoint(e.currentTarget, e.clientX, e.clientY)
          window.getSelection()?.removeAllRanges()
          setEditCaret(resolveCaretOffset(fragment.content, anchor))
          setShowActions(false)
          setActionMode(null)
          setEditingContent(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setShowActions(false); return }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (!isStreamingAction) setShowActions(v => !v)
          }
        }}
        className={`text-left w-full rounded-lg p-4 -mx-4 transition-all duration-150 cursor-default ${
          showActions ? 'bg-card/50 ring-1 ring-primary/10' : 'hover:bg-card/40'
        }`}
        data-component-id={`prose-${fragment.id}-select`}
      >
        {(isStreamingAction || streamedActionText) && actionThoughtSteps.length > 0 && (
          <GenerationThoughts
            steps={actionThoughtSteps}
            streaming={isStreamingAction}
            hasText={!!streamedActionText}
            defaultExpanded={expandThoughtsByDefault ?? true}
          />
        )}
        <StreamMarkdown
          content={(isStreamingAction || streamedActionText)
            ? streamedActionText || ''
            : processedContent
          }
          streaming={isStreamingAction}
          variant="prose"
          textTransform={!isStreamingAction && !streamedActionText ? textTransform : undefined}
        />

      </div>
      )}

      {/* Action toolbar — compact pill near click point (mouse), docked to the bottom (touch).
          Docked is portaled: the virtualized chain's transformed ancestors would trap `fixed`. */}
      {(showActions || actionMode) && !isStreamingAction && !editingContent && (() => {
        const toolbar = (
        <div
          ref={actionPanelRef}
          className={isCoarsePointer
            ? 'fixed inset-x-0 bottom-0 z-50 flex justify-center animate-in fade-in slide-in-from-bottom-2 duration-150'
            : 'absolute left-0 right-0 z-10 flex justify-center animate-in fade-in zoom-in-95 duration-150'}
          style={isCoarsePointer
            ? {
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
                paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 0.75rem)',
                paddingRight: 'calc(env(safe-area-inset-right, 0px) + 0.75rem)',
              }
            : toolbarPlacement(clickY)}
          data-component-id="prose-block-actions"
          data-docked={isCoarsePointer || undefined}
        >
          {actionMode ? (
            /* Regenerate input — inline textarea */
            <div className="w-full max-w-md rounded-xl border border-border/40 bg-popover/95 backdrop-blur-md shadow-lg shadow-black/[0.06] overflow-hidden">
              <textarea
                ref={actionInputRef}
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                placeholder="New direction..."
                className="w-full resize-none bg-transparent px-3.5 py-2.5 text-sm placeholder:italic placeholder:text-muted-foreground/60 focus:outline-none"
                rows={2}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setActionMode(null); setActionInput('') }
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleActionSubmit() }
                }}
              />
              <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/20">
                <span className="text-[0.6rem] text-muted-foreground/50 font-mono tracking-wide">
                  ESC &middot; CTRL+ENTER
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="px-2 py-0.5 rounded-md text-[0.6875rem] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => { setActionMode(null); setActionInput('') }}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-2.5 py-0.5 rounded-md text-[0.6875rem] font-medium bg-foreground/[0.07] hover:bg-foreground/[0.12] text-foreground disabled:opacity-30 transition-all"
                    disabled={!actionInput.trim()}
                    onClick={handleActionSubmit}
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Two-tier action toolbar */
            <div className="flex flex-col rounded-xl border border-border/30 bg-popover/95 backdrop-blur-md shadow-lg shadow-black/[0.06] overflow-hidden min-w-0">
              {/* Top tier — ID, variation, secondary icon actions */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 min-w-0">
                <button
                  className="text-[0.625rem] font-mono text-muted-foreground/60 hover:text-foreground transition-colors shrink-0 select-all"
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(fragment.id) }}
                  title="Copy ID"
                >
                  {fragment.id}
                </button>
                {hasMultiple && (
                  <>
                    <div className="w-px h-3 bg-border/20" />
                    <div className="inline-flex items-center gap-0 shrink-0">
                      <button
                        className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/60 transition-all disabled:opacity-25"
                        disabled={!canPrev || switchMutation.isPending}
                        onClick={() => switchVariation(-1)}
                        title="Previous variation"
                      >
                        <ChevronLeft className="size-3" />
                      </button>
                      <span className="text-[0.5625rem] font-mono text-muted-foreground/50 tabular-nums min-w-[1.5rem] text-center">{variationIndex + 1}/{variationCount}</span>
                      <button
                        className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/60 transition-all disabled:opacity-25"
                        disabled={!canNext || switchMutation.isPending}
                        onClick={() => switchVariation(1)}
                        title="Next variation"
                      >
                        <ChevronRight className="size-3" />
                      </button>
                    </div>
                  </>
                )}
                <div className="ml-auto flex items-center gap-0.5 shrink-0">
                  {onBranchFrom && sectionIndex >= 0 && (
                    <button
                      className="p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent/60 transition-all"
                      onClick={() => { onBranchFrom(sectionIndex); setShowActions(false) }}
                      title="Split from here"
                      data-component-id={`prose-${fragment.id}-branch`}
                    >
                      <GitBranch className="size-3" />
                    </button>
                  )}
                  <button
                    className="p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent/60 transition-all"
                    onClick={() => { onSelect(fragment); setShowActions(false) }}
                    title="Details"
                  >
                    <Info className="size-3" />
                  </button>
                  {!!fragment.meta?.generatedFrom && onDebugLog && (
                    <button
                      className="p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent/60 transition-all"
                      onClick={() => { onDebugLog(fragment.id); setShowActions(false) }}
                      title="Debug log"
                    >
                      <Bug className="size-3" />
                    </button>
                  )}
                  {sectionIndex >= 0 && (
                    <button
                      className="p-1 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all disabled:opacity-25"
                      disabled={deleteMutation.isPending}
                      onClick={async () => {
                        if (await confirm({ title: 'Remove this passage?', description: 'It will be archived.', confirmText: 'Remove', destructive: true })) {
                          deleteMutation.mutate()
                          setShowActions(false)
                        }
                      }}
                      title="Remove passage"
                      data-component-id={`prose-${fragment.id}-remove`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
              </div>
              {/* Divider */}
              <div className="h-px bg-border/15" />
              {/* Bottom tier — primary actions. Wraps so the last action
                  (Read aloud) isn't clipped on narrow / mobile widths. */}
              <div className="flex flex-wrap items-center gap-px px-1 py-0.5">
                <button
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.6875rem] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all disabled:opacity-25"
                  onClick={() => { if (onEdit) { onEdit(fragment.id, window.getSelection()?.toString() || undefined); setShowActions(false) } }}
                  disabled={!onEdit}
                  data-component-id={`prose-${fragment.id}-edit`}
                >
                  <PenLine className="size-3.5" />
                  Edit
                </button>
                <button
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.6875rem] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all disabled:opacity-25"
                  onClick={() => {
                    setShowActions(false)
                    handleQuickRegenerate()
                  }}
                  disabled={!canQuickRegenerate}
                  data-component-id={`prose-${fragment.id}-regenerate`}
                >
                  <RefreshCw className="size-3.5" />
                  Redo
                </button>
                {onAskLibrarian && (
                  <>
                    <button
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.6875rem] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all"
                      onClick={() => { onAskLibrarian(fragment.id, `refine ${fragment.id}: `); setShowActions(false) }}
                      data-component-id={`prose-${fragment.id}-refine`}
                    >
                      <MessageSquare className="size-3.5" />
                      Refine
                    </button>
                    <button
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.6875rem] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all"
                      onClick={() => { onAskLibrarian(fragment.id); setShowActions(false) }}
                      data-component-id={`prose-${fragment.id}-ask`}
                    >
                      <MessageSquare className="size-3.5" />
                      Ask
                    </button>
                  </>
                )}
                {onAnalyze && (
                  <button
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.6875rem] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all"
                    onClick={() => { onAnalyze(fragment.id); setShowActions(false) }}
                    data-component-id={`prose-${fragment.id}-analyze`}
                  >
                    <BookOpen className="size-3.5" />
                    Analyze
                  </button>
                )}
                <button
                  aria-disabled={!ttsSettings.enabled || undefined}
                  title={ttsSettings.enabled ? undefined : 'Enable Read aloud in Settings to use this'}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.6875rem] transition-all ${
                    !ttsSettings.enabled
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : isReadingThis
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                  }`}
                  onClick={() => {
                    if (!ttsSettings.enabled) return
                    if (isReadingThis) stopTts()
                    else {
                      // Read just the selection when one lies inside this block;
                      // a stray selection elsewhere shouldn't hijack playback.
                      const selection = window.getSelection()
                      const inThisBlock = selection?.anchorNode != null
                        && blockRef.current?.contains(selection.anchorNode) === true
                      const { text, isSelection } = resolveReadAloudText(
                        inThisBlock ? selection?.toString() : undefined,
                        fragment.content,
                      )
                      playFragment(
                        fragment.id,
                        text,
                        isSelection ? `${fragment.name} · selection` : fragment.name,
                        ttsSettings,
                      )
                    }
                    setShowActions(false)
                  }}
                  data-component-id={`prose-${fragment.id}-read-aloud`}
                >
                  {isReadingThis ? <Square className="size-3.5" /> : <Volume2 className="size-3.5" />}
                  {isReadingThis ? 'Stop' : 'Read aloud'}
                </button>
              </div>
            </div>
          )}
        </div>
        )
        return isCoarsePointer ? createPortal(toolbar, document.body) : toolbar
      })()}

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
})
