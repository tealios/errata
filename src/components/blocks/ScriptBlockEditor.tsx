import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { BlockPreviewResponse } from '@/lib/api/types'
import { ScriptEditor } from './ScriptEditor'
import { BlockContentView } from './BlockContentView'
import {
  ChevronDown,
  ChevronRight,
  Check,
  BookOpen,
  Copy,
  Loader2,
  Maximize2,
  PanelRightOpen,
  PanelRightClose,
  RefreshCw,
  X,
} from 'lucide-react'
import { componentId } from '@/lib/dom-ids'

// ── Context source ───────────────────────────────────────────────
//
// Script blocks live in one of two places: an agent's prompt or the
// main generation prompt. Passing the source lets the expanded view
// fetch the right compiled preview so the author can see where their
// script's output lands in the full context.

export type ScriptBlockContext =
  | { type: 'agent'; agentName: string }
  | { type: 'generation' }

type EvalResult = { result: string | null; error: string | null } | null

export function ScriptBlockEditor({
  storyId,
  blockId,
  blockName,
  blockRole,
  value,
  onSave,
  context,
}: {
  storyId: string
  blockId: string
  /** Display name of the block — shown in the expanded-view header. */
  blockName?: string
  /** system or user — shown as a meta tag alongside the name. */
  blockRole?: 'system' | 'user'
  value: string
  onSave: (value: string) => void
  /** If present, the expanded view offers a "Show context" pane. */
  context?: ScriptBlockContext
}) {
  const [local, setLocal] = useState(value)
  const savedRef = useRef(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [evalResult, setEvalResult] = useState<EvalResult>(null)
  const [evalLoading, setEvalLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const requestIdRef = useRef(0)

  // Fragment hints — fed to the editor's completion system so `ctx.getFragment('...'`
  // suggests real IDs and `ctx.getFragments('...'` suggests real type names.
  const { data: fragments } = useQuery({
    queryKey: ['fragments', storyId],
    queryFn: () => api.fragments.list(storyId),
    staleTime: 30_000,
  })
  const fragmentHints = useMemo(
    () => (fragments ?? []).map(f => ({ id: f.id, name: f.name, type: f.type })),
    [fragments],
  )

  useEffect(() => {
    setLocal(value)
    savedRef.current = value
  }, [value])

  // Debounced eval — 400ms is fast enough to feel live without hammering the server.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!local.trim()) {
      setEvalResult(null)
      setEvalLoading(false)
      return
    }
    setEvalLoading(true)
    const id = ++requestIdRef.current
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.blocks.evalScript(storyId, local)
        if (id === requestIdRef.current) {
          setEvalResult(res)
          setEvalLoading(false)
        }
      } catch {
        if (id === requestIdRef.current) {
          setEvalResult({ result: null, error: 'Failed to evaluate script' })
          setEvalLoading(false)
        }
      }
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [local, storyId])

  const saveIfDirty = useCallback(() => {
    if (local !== savedRef.current) {
      onSave(local)
      savedRef.current = local
    }
  }, [local, onSave])

  const hasError = !!evalResult?.error

  return (
    <div className="space-y-2">
      <div className="relative group/script">
        <ScriptEditor
          value={local}
          onChange={setLocal}
          onBlur={saveIfDirty}
          placeholder="return `...`"
          minHeight="80px"
          hasError={hasError}
          fragmentHints={fragmentHints}
          dataComponentId={componentId('block', blockId, 'content')}
        />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Open expanded editor"
          className="absolute top-1.5 right-1.5 p-1 rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 opacity-0 group-hover/script:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <Maximize2 className="size-3" aria-hidden="true" />
        </button>
      </div>

      <OutputPane
        evalResult={evalResult}
        evalLoading={evalLoading}
        hasInput={!!local.trim()}
        variant="compact"
      />

      {expanded && (
        <ExpandedScriptView
          storyId={storyId}
          blockId={blockId}
          blockName={blockName}
          blockRole={blockRole}
          value={local}
          onChange={setLocal}
          onClose={() => {
            saveIfDirty()
            setExpanded(false)
          }}
          onSaveDirty={saveIfDirty}
          evalResult={evalResult}
          evalLoading={evalLoading}
          hasError={hasError}
          context={context}
          fragmentHints={fragmentHints}
        />
      )}
    </div>
  )
}

// ── Output pane (shared) ────────────────────────────────────────

function OutputPane({
  evalResult,
  evalLoading,
  hasInput,
  variant,
}: {
  evalResult: EvalResult
  evalLoading: boolean
  hasInput: boolean
  variant: 'compact' | 'expanded'
}) {
  const hasError = !!evalResult?.error
  const preClass = variant === 'compact'
    ? 'whitespace-pre-wrap text-[0.6875rem] rounded-md p-2.5 max-h-[120px] overflow-y-auto border leading-relaxed font-mono'
    : 'whitespace-pre-wrap text-[0.8125rem] rounded-md p-4 border leading-relaxed font-mono'

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[0.5625rem] text-muted-foreground uppercase tracking-[0.15em] font-medium">
          Output
        </span>
        {evalLoading && (
          <span className="inline-flex items-center gap-1 text-muted-foreground/50">
            <span className="inline-block size-1 rounded-full bg-primary/50 animate-wisp-breathe" aria-hidden="true" />
            <span className="text-[0.5625rem] uppercase tracking-[0.15em]">running</span>
          </span>
        )}
      </div>
      {hasError ? (
        <pre className={`${preClass} text-destructive/90 bg-destructive/5 border-destructive/15`}>
          {evalResult!.error}
        </pre>
      ) : evalResult?.result ? (
        <pre className={`${preClass} text-foreground/80 bg-muted/15 border-border/15`}>
          {evalResult.result}
        </pre>
      ) : !evalLoading && hasInput ? (
        <p className="text-xs font-display italic text-muted-foreground/50 px-1">
          (no output yet)
        </p>
      ) : !hasInput ? (
        <p className="text-xs font-display italic text-muted-foreground/50 px-1">
          Write a script — the output will appear here as you type.
        </p>
      ) : null}
    </div>
  )
}

// ── Expanded split view ─────────────────────────────────────────

function formatContextLabel(context?: ScriptBlockContext): string {
  if (!context) return ''
  if (context.type === 'generation') return 'Generation'
  return context.agentName
    .split('.')
    .map(p => p.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    .join(' · ')
}

function ExpandedScriptView({
  storyId,
  blockId,
  blockName,
  blockRole,
  value,
  onChange,
  onClose,
  onSaveDirty,
  evalResult,
  evalLoading,
  hasError,
  context,
  fragmentHints,
}: {
  storyId: string
  blockId: string
  blockName?: string
  blockRole?: 'system' | 'user'
  value: string
  onChange: (v: string) => void
  onClose: () => void
  onSaveDirty: () => void
  evalResult: EvalResult
  evalLoading: boolean
  hasError: boolean
  context?: ScriptBlockContext
  fragmentHints?: Array<{ id: string; name: string; type: string }>
}) {
  const queryClient = useQueryClient()
  const [showContext, setShowContext] = useState(false)
  const canShowContext = !!context

  // Esc closes. Capture-phase so we win over outer dialogs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [onClose])

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // All context previews route through the per-agent preview API. Generation
  // blocks are just the generation.writer agent's config — they always were —
  // so the client resolves 'generation' context to that agent name.
  const previewAgentName = context?.type === 'agent'
    ? context.agentName
    : 'generation.writer'

  const previewQueryKey = ['agent-block-preview', storyId, previewAgentName] as const

  const { data: preview, isFetching: previewLoading, refetch: refetchPreview } = useQuery<BlockPreviewResponse>({
    queryKey: previewQueryKey,
    queryFn: () => api.agentBlocks.preview(storyId, previewAgentName),
    enabled: canShowContext && showContext,
    staleTime: 0,
  })

  // Save-then-refresh so the context pane reflects the just-typed script.
  const handleRefreshContext = useCallback(async () => {
    onSaveDirty()
    await queryClient.invalidateQueries({ queryKey: previewQueryKey })
    await refetchPreview()
  }, [onSaveDirty, queryClient, previewQueryKey, refetchPreview])

  const bodyClass = showContext
    ? 'flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.1fr)]'
    : 'flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Expanded script editor"
      data-cuelume-surface="bloom"
      className="fixed inset-0 z-50 flex flex-col bg-background p-safe animate-onboarding-fade-in"
    >
      {/* Header — block identity on the left, controls on the right.
          Two-line layout: block name (serif display) above a small meta row. */}
      <header className="shrink-0 flex items-start justify-between gap-4 px-6 py-3 border-b border-border/40">
        <div className="min-w-0 flex flex-col gap-0.5">
          <p className="font-display italic text-xl leading-tight text-foreground truncate">
            {blockName || 'Untitled block'}
          </p>
          <div className="flex items-center gap-2 text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground">
            {context && (
              <>
                <span className="font-medium">{formatContextLabel(context)}</span>
                <span aria-hidden="true" className="text-muted-foreground/40">·</span>
              </>
            )}
            {blockRole && (
              <>
                <span>{blockRole}</span>
                <span aria-hidden="true" className="text-muted-foreground/40">·</span>
              </>
            )}
            <span>JavaScript</span>
            <span aria-hidden="true" className="text-muted-foreground/40">·</span>
            <span className="font-mono normal-case tracking-normal text-muted-foreground/60">
              {blockId}
            </span>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {canShowContext && (
            <button
              type="button"
              onClick={() => setShowContext(v => !v)}
              aria-pressed={showContext}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-display italic transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                showContext
                  ? 'text-foreground bg-muted/50'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
            >
              {showContext
                ? <PanelRightClose className="size-3.5" aria-hidden="true" />
                : <PanelRightOpen className="size-3.5" aria-hidden="true" />
              }
              {showContext ? 'Hide context' : 'Show context'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close expanded editor"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Body — editor | output [| context] */}
      <div className={bodyClass}>
        <section className="min-h-0 overflow-auto p-5 md:p-7 md:pr-4 flex flex-col">
          <ScriptEditor
            value={value}
            onChange={onChange}
            placeholder="return `...`"
            minHeight="100%"
            height="100%"
            hasError={hasError}
            autoFocus
            fragmentHints={fragmentHints}
            className="flex-1 min-h-0"
          />
        </section>

        <section
          className="min-h-0 overflow-auto p-5 md:p-7 md:px-4 border-t md:border-t-0 md:border-l border-border/40 flex flex-col gap-2"
          aria-live="polite"
        >
          <OutputPane
            evalResult={evalResult}
            evalLoading={evalLoading}
            hasInput={!!value.trim()}
            variant="expanded"
          />
        </section>

        {showContext && (
          <section
            className="min-h-0 overflow-hidden flex flex-col border-t md:border-t-0 md:border-l border-border/40"
            aria-label="Full agent context"
          >
            {/* Mini-header inside the context pane */}
            <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border/30">
              <div className="flex items-center gap-2">
                <span className="text-[0.5625rem] text-muted-foreground uppercase tracking-[0.15em] font-medium">
                  Full context
                </span>
                {previewLoading && (
                  <span className="inline-block size-1 rounded-full bg-primary/50 animate-wisp-breathe" aria-hidden="true" />
                )}
              </div>
              <button
                type="button"
                onClick={handleRefreshContext}
                aria-label="Refresh context"
                className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground hover:text-foreground transition-colors font-display italic focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded px-1.5 py-0.5"
                disabled={previewLoading}
              >
                <RefreshCw
                  className={`size-3 ${previewLoading ? 'animate-spinner-rotate' : ''}`}
                  aria-hidden="true"
                />
                refresh
              </button>
            </div>

            {/* Preview body */}
            <div className="flex-1 min-h-0 flex">
              {preview ? (
                <ContextPane preview={preview} highlightBlockId={blockId} />
              ) : (
                <div className="flex-1 flex items-center justify-center p-6">
                  <span className="text-xs font-display italic text-muted-foreground/60">
                    Loading context…
                  </span>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Footer hint */}
      <footer className="shrink-0 flex items-center justify-between px-6 py-2 border-t border-border/30 text-[0.6875rem] text-muted-foreground/70">
        <span className="font-display italic">
          Press <kbd className="font-mono text-[0.625rem] px-1 py-0.5 rounded bg-muted/50 not-italic">Esc</kbd> to close
        </span>
        <span className="font-display italic">
          The preview runs {evalLoading ? 'now' : 'as you type'}.
        </span>
      </footer>
    </div>,
    document.body,
  )
}

// ── Context pane — reuses BlockContentView with a highlight hint ─

function ContextPane({
  preview,
  highlightBlockId,
}: {
  preview: BlockPreviewResponse
  highlightBlockId: string
}) {
  // Scroll the currently-edited block into view after content mounts.
  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-block-id="${highlightBlockId}"]`)
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'center' })
    }, 50)
    return () => clearTimeout(t)
  }, [highlightBlockId, preview])

  return (
    <BlockContentView
      messages={preview.messages}
      blocks={preview.blocks}
      className="flex-1"
    />
  )
}

export function FragmentReference({ storyId }: { storyId: string }) {
  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const { data: fragments } = useQuery({
    queryKey: ['fragments', storyId],
    queryFn: () => api.fragments.list(storyId),
    enabled: open,
  })

  const grouped = useMemo(() => {
    if (!fragments) return new Map<string, Array<{ id: string; name: string }>>()
    const map = new Map<string, Array<{ id: string; name: string }>>()
    for (const f of fragments) {
      const list = map.get(f.type) ?? []
      list.push({ id: f.id, name: f.name })
      map.set(f.type, list)
    }
    return map
  }, [fragments])

  const handleCopy = useCallback((id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1200)
  }, [])

  return (
    <div>
      <button
        className="flex items-center gap-1.5 text-[0.625rem] text-muted-foreground hover:text-foreground/70 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <BookOpen className="size-3" />
        <span className="font-medium">Fragment Reference</span>
      </button>

      {open && (
        <div className="mt-2 rounded-md border border-border/20 bg-muted/10 p-2 max-h-[200px] overflow-y-auto space-y-2">
          {!fragments ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="size-3 text-muted-foreground animate-spin" />
            </div>
          ) : grouped.size === 0 ? (
            <p className="text-[0.625rem] text-muted-foreground/50 italic text-center py-2">No fragments</p>
          ) : (
            Array.from(grouped.entries()).map(([type, items]) => (
              <div key={type}>
                <p className="text-[0.5625rem] text-muted-foreground uppercase tracking-[0.12em] font-medium mb-1">{type}</p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 group/ref px-1 py-0.5 rounded hover:bg-muted/30">
                      <button
                        className="flex items-center gap-1 shrink-0"
                        onClick={() => handleCopy(item.id)}
                        title="Copy ID"
                      >
                        <code className="text-[0.625rem] font-mono text-primary/70">{item.id}</code>
                        {copiedId === item.id ? (
                          <Check className="size-2.5 text-emerald-500" />
                        ) : (
                          <Copy className="size-2.5 text-muted-foreground/40 opacity-0 group-hover/ref:opacity-100 transition-opacity" />
                        )}
                      </button>
                      <span className="text-[0.625rem] text-muted-foreground truncate">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
