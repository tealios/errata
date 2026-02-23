import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { PenLine, ChevronsDown, ArrowRight, Pause, Compass, RefreshCw, Loader2, PenSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SuggestionDirection } from '@/lib/api/types'

export type ThoughtStep =
  | { type: 'reasoning'; text: string }
  | { type: 'prewriter-text'; text: string }
  | { type: 'tool-call'; id: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; toolName: string; result: unknown }
  | { type: 'phase'; phase: string }

type InputMode = 'freeform' | 'guided'

interface InlineGenerationInputProps {
  storyId: string
  isGenerating: boolean
  followGeneration: boolean
  onToggleFollowGeneration: () => void
  onGenerationStart: () => void
  onGenerationStream: (text: string) => void
  onGenerationThoughts?: (steps: ThoughtStep[]) => void
  onGenerationComplete: () => void
  onGenerationError: () => void
}

const STORAGE_KEY = 'errata:generation-mode'

const DEFAULT_CONTINUE_INSTRUCTION = 'Continue the story naturally. Write the next scene, advancing the plot and developing characters.'
const DEFAULT_SCENE_SETTING_INSTRUCTION = "Continue the story without advancing the plot. Focus on atmosphere, internal thoughts, sensory details, or character moments. Don't introduce new events or move the story forward."

export function InlineGenerationInput({
  storyId,
  isGenerating,
  followGeneration,
  onToggleFollowGeneration,
  onGenerationStart,
  onGenerationStream,
  onGenerationThoughts,
  onGenerationComplete,
  onGenerationError,
}: InlineGenerationInputProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Mode state with localStorage persistence
  const [mode, setMode] = useState<InputMode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored === 'guided' ? 'guided' : 'freeform'
    } catch {
      return 'freeform'
    }
  })

  // Suggestion state
  const [suggestions, setSuggestions] = useState<SuggestionDirection[]>([])
  const [manualSuggestions, setManualSuggestions] = useState<SuggestionDirection[] | null>(null)
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)

  // Poll librarian status to detect when analysis completes
  const { data: librarianStatus } = useQuery({
    queryKey: ['librarian-status', storyId],
    queryFn: () => api.librarian.getStatus(storyId),
    refetchInterval: 5_000,
  })

  const prevRunStatusRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prev = prevRunStatusRef.current
    const curr = librarianStatus?.runStatus
    prevRunStatusRef.current = curr
    // When analysis transitions from running → idle/error, refresh analyses and prose fragments
    // (librarian writes annotations to fragment.meta, so prose fragments must be re-fetched)
    if (prev === 'running' && (curr === 'idle' || curr === 'error')) {
      queryClient.invalidateQueries({ queryKey: ['librarian-analyses', storyId] })
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId, 'prose'] })
    }
  }, [librarianStatus?.runStatus, queryClient, storyId])

  // Query latest analysis for auto-populated directions
  const { data: analysesList } = useQuery({
    queryKey: ['librarian-analyses', storyId],
    queryFn: () => api.librarian.listAnalyses(storyId),
  })

  const latestAnalysisId = analysesList?.[0]?.directionsCount ? analysesList[0].id : null

  const { data: latestAnalysis } = useQuery({
    queryKey: ['librarian-analysis', storyId, latestAnalysisId],
    queryFn: () => api.librarian.getAnalysis(storyId, latestAnalysisId!),
    enabled: !!latestAnalysisId,
    staleTime: 60_000,
  })

  const analysisDirections = useMemo(
    () => latestAnalysis?.directions ?? [],
    [latestAnalysis?.directions],
  )

  // Merge: prewriter/manual directions first, then append analysis directions (deduplicated by title)
  useEffect(() => {
    const base = manualSuggestions ?? []
    const baseTitles = new Set(base.map(s => s.title))
    const extra = analysisDirections.filter(s => !baseTitles.has(s.title))
    const merged = [...base, ...extra]
    if (merged.length > 0) {
      setSuggestions(merged)
    }
  }, [manualSuggestions, analysisDirections])

  const handleModeChange = (newMode: InputMode) => {
    setMode(newMode)
    try { localStorage.setItem(STORAGE_KEY, newMode) } catch {}
  }

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

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [input])

  const prewriterDirectionsRef = useRef<SuggestionDirection[] | null>(null)

  const handleGenerateWithInput = useCallback(async (generationInput: string) => {
    if (!generationInput.trim() || isGenerating) return

    onGenerationStart()
    setError(null)
    prewriterDirectionsRef.current = null

    const ac = new AbortController()
    abortRef.current = ac

    try {
      const stream = await api.generation.generateAndSave(storyId, generationInput, ac.signal)

      const reader = stream.getReader()
      let accumulatedText = ''
      let accumulatedReasoning = ''
      const thoughtSteps: ThoughtStep[] = []
      let thoughtsDirty = false
      let rafScheduled = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        if (value.type === 'text') {
          accumulatedText += value.text
        } else if (value.type === 'reasoning') {
          accumulatedReasoning += value.text
          const last = thoughtSteps[thoughtSteps.length - 1]
          if (last && last.type === 'reasoning') {
            last.text = accumulatedReasoning
          } else {
            thoughtSteps.push({ type: 'reasoning', text: accumulatedReasoning })
          }
          thoughtsDirty = true
        } else if (value.type === 'tool-call') {
          accumulatedReasoning = ''
          thoughtSteps.push({ type: 'tool-call', id: value.id, toolName: value.toolName, args: value.args })
          thoughtsDirty = true
        } else if (value.type === 'tool-result') {
          thoughtSteps.push({ type: 'tool-result', id: value.id, toolName: value.toolName, result: value.result })
          thoughtsDirty = true
        } else if (value.type === 'prewriter-text') {
          const last = thoughtSteps[thoughtSteps.length - 1]
          if (last && last.type === 'prewriter-text') {
            last.text += value.text
          } else {
            accumulatedReasoning = ''
            thoughtSteps.push({ type: 'prewriter-text', text: value.text })
          }
          thoughtsDirty = true
        } else if (value.type === 'prewriter-directions') {
          prewriterDirectionsRef.current = value.directions
        } else if (value.type === 'phase') {
          accumulatedReasoning = ''
          thoughtSteps.push({ type: 'phase', phase: value.phase })
          thoughtsDirty = true
        }

        if (!rafScheduled) {
          rafScheduled = true
          const textSnapshot = accumulatedText
          const stepsSnapshot = thoughtsDirty ? [...thoughtSteps] : null
          thoughtsDirty = false
          requestAnimationFrame(() => {
            onGenerationStream(textSnapshot)
            if (stepsSnapshot) onGenerationThoughts?.(stepsSnapshot)
            rafScheduled = false
          })
        }
      }

      // Final flush
      onGenerationStream(accumulatedText)
      if (thoughtSteps.length > 0) onGenerationThoughts?.([...thoughtSteps])

      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })

      if (prewriterDirectionsRef.current?.length) {
        setManualSuggestions(prewriterDirectionsRef.current)
      }

      setInput('')
      onGenerationComplete()
    } catch (err) {
      // User-initiated abort — not an error
      if (ac.signal.aborted) {
        await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
        await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
        onGenerationComplete()
      } else {
        setError(err instanceof Error ? err.message : 'Generation failed')
        onGenerationError()
      }
    } finally {
      abortRef.current = null
    }
  }, [storyId, isGenerating, onGenerationStart, onGenerationStream, onGenerationThoughts, onGenerationComplete, onGenerationError, queryClient])

  const handleGenerate = () => {
    handleGenerateWithInput(input)
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleFetchSuggestions = async () => {
    setIsFetchingSuggestions(true)
    setSuggestionError(null)
    try {
      const result = await api.generation.suggestDirections(storyId)
      setManualSuggestions(result.suggestions)
    } catch (err) {
      setSuggestionError(err instanceof Error ? err.message : 'Failed to load suggestions')
    } finally {
      setIsFetchingSuggestions(false)
    }
  }

  // Resolve current model label
  const generationProviderId = story?.settings.modelOverrides?.generation?.providerId ?? null
  const modelLabel = (() => {
    if (!globalConfig) return null
    const providers = globalConfig.providers.filter(p => p.enabled)
    if (generationProviderId) {
      const p = providers.find(p => p.id === generationProviderId)
      if (p) return p.defaultModel
    }
    const defaultP = globalConfig.defaultProviderId
      ? providers.find(p => p.id === globalConfig.defaultProviderId)
      : null
    return defaultP?.defaultModel ?? ''
  })()

  return (
    <div className="relative mt-2" data-component-id="inline-generation-root">
      {/* Error */}
      {(error || suggestionError) && (
        <div className="text-sm text-destructive mb-3 font-sans">
          {error || suggestionError}
        </div>
      )}

      {/* Unified input container */}
      <div
        className={cn(
          'relative rounded-xl border transition-all duration-300',
          mode === 'freeform' && isFocused
            ? 'border-primary/25 shadow-[0_0_0_1px_var(--primary)/8%,0_2px_12px_-2px_var(--primary)/6%] bg-card/60'
            : 'border-border/30 bg-card/20 hover:border-border/50 hover:bg-card/30',
        )}
      >
        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 px-3 pt-2.5 pb-1">
          <button
            type="button"
            onClick={() => handleModeChange('freeform')}
            className={cn(
              'px-2.5 py-1 text-[11px] font-sans rounded-md transition-all duration-200',
              mode === 'freeform'
                ? 'text-foreground/80 bg-muted/60 font-medium'
                : 'text-muted-foreground hover:text-foreground/60 hover:bg-muted/30',
            )}
          >
            Freeform
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('guided')}
            className={cn(
              'px-2.5 py-1 text-[11px] font-sans rounded-md transition-all duration-200',
              mode === 'guided'
                ? 'text-foreground/80 bg-muted/60 font-medium'
                : 'text-muted-foreground hover:text-foreground/60 hover:bg-muted/30',
            )}
          >
            Guided
          </button>
        </div>

        {/* Freeform mode — original textarea */}
        {mode === 'freeform' && (
          <textarea
            ref={textareaRef}
            data-component-id="inline-generation-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="What happens next..."
            rows={1}
            className="w-full resize-none bg-transparent border-none outline-none px-4 pt-1.5 pb-2 font-prose text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground placeholder:italic disabled:opacity-40"
            style={{ minHeight: '44px', maxHeight: '200px', overflowY: 'auto', scrollbarWidth: 'none' }}
            disabled={isGenerating}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                handleGenerate()
              }
            }}
          />
        )}

        {/* Guided mode */}
        {mode === 'guided' && (
          <div className="px-3 pt-1.5 pb-2">
            {/* Quick action buttons */}
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => handleGenerateWithInput(story?.settings.guidedContinuePrompt || DEFAULT_CONTINUE_INSTRUCTION)}
                className={cn(
                  'group flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border transition-all duration-200 text-left',
                  'border-border/30 hover:border-primary/30 hover:bg-primary/[0.04]',
                  'disabled:opacity-40 disabled:pointer-events-none',
                )}
              >
                <div className="shrink-0 size-7 rounded-md bg-primary/10 flex items-center justify-center transition-colors group-hover:bg-primary/15">
                  <ArrowRight className="size-3.5 text-primary/70" />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-foreground/85 font-sans leading-tight">Continue</div>
                  <div className="text-[10.5px] text-muted-foreground leading-snug mt-0.5">Advance the plot naturally</div>
                </div>
              </button>
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => handleGenerateWithInput(story?.settings.guidedSceneSettingPrompt || DEFAULT_SCENE_SETTING_INSTRUCTION)}
                className={cn(
                  'group flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border transition-all duration-200 text-left',
                  'border-border/30 hover:border-primary/30 hover:bg-primary/[0.04]',
                  'disabled:opacity-40 disabled:pointer-events-none',
                )}
              >
                <div className="shrink-0 size-7 rounded-md bg-primary/10 flex items-center justify-center transition-colors group-hover:bg-primary/15">
                  <Pause className="size-3.5 text-primary/70" />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-foreground/85 font-sans leading-tight">Scene-setting</div>
                  <div className="text-[10.5px] text-muted-foreground leading-snug mt-0.5">Atmosphere &amp; character moments</div>
                </div>
              </button>
            </div>

            {/* Suggest directions */}
            {suggestions.length === 0 && !isFetchingSuggestions && (
              <button
                type="button"
                disabled={isGenerating}
                onClick={handleFetchSuggestions}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-2 rounded-lg transition-all duration-200',
                  'text-[12px] font-sans text-muted-foreground hover:text-foreground/70',
                  'border border-dashed border-border/40 hover:border-primary/25 hover:bg-primary/[0.02]',
                  'disabled:opacity-40 disabled:pointer-events-none',
                )}
              >
                <Compass className="size-3.5" />
                Suggest directions
              </button>
            )}

            {/* Loading state */}
            {isFetchingSuggestions && (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="size-4 text-primary/50 animate-spin" />
                <span className="text-[12px] text-muted-foreground font-sans italic">Imagining possibilities...</span>
              </div>
            )}

            {/* Suggestion cards */}
            {suggestions.length > 0 && !isFetchingSuggestions && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-muted-foreground font-sans uppercase tracking-wider">Directions</span>
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={handleFetchSuggestions}
                    className="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground/60 transition-colors disabled:opacity-30"
                  >
                    <RefreshCw className="size-3" />
                  </button>
                </div>
                {suggestions.map((s, i) => (
                  <div
                    key={i}
                    className={cn(
                      'group/card flex items-stretch rounded-lg border transition-all duration-200',
                      'border-border/25 hover:border-primary/25 bg-card/30 hover:bg-primary/[0.03]',
                      isGenerating && 'opacity-40 pointer-events-none',
                    )}
                  >
                    <button
                      type="button"
                      disabled={isGenerating}
                      onClick={() => { setManualSuggestions(null); setSuggestions([]); handleGenerateWithInput(s.instruction) }}
                      className="flex-1 text-left px-3.5 py-2.5 min-w-0"
                    >
                      <div className="text-[13px] font-medium text-foreground/80 font-sans leading-snug group-hover/card:text-foreground/90 transition-colors">
                        {s.title}
                      </div>
                      <div className="text-[11.5px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">
                        {s.description}
                      </div>
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={isGenerating}
                          onClick={() => {
                            setInput(s.instruction)
                            handleModeChange('freeform')
                            requestAnimationFrame(() => textareaRef.current?.focus())
                          }}
                          className="shrink-0 flex items-center justify-center w-9 border-l border-border/20 text-muted-foreground/40 hover:text-foreground/60 hover:bg-muted/30 transition-colors rounded-r-lg"
                        >
                          <PenSquare className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">Edit before sending</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
          {/* Left: Model selector + Follow toggle */}
          <div className="flex items-center gap-2">
            {globalConfig && (
              <div className="relative group/model">
                <select
                  data-component-id="inline-generation-provider-select"
                  value={generationProviderId ?? ''}
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
                            : `No provider`}
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
                <button
                  type="button"
                  className={cn(
                    'size-6 flex items-center justify-center rounded-md transition-colors duration-150',
                    followGeneration
                      ? 'text-foreground/60 bg-muted/50'
                      : 'text-muted-foreground hover:text-muted-foreground',
                  )}
                  onClick={onToggleFollowGeneration}
                  data-component-id="inline-generation-follow-toggle"
                >
                  <ChevronsDown className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {followGeneration
                  ? 'Auto-scroll on — click to pin scroll position'
                  : 'Auto-scroll off — click to follow generation'}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Right: Write/Stop button + shortcut hint */}
          <div className="flex items-center gap-2.5">
            {mode === 'freeform' && !isGenerating && (
              <span className="text-[10px] text-muted-foreground font-sans select-none hidden sm:inline">
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
            ) : mode === 'freeform' ? (
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
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
