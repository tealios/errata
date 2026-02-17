import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { PenLine, ChevronsDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InlineGenerationInputProps {
  storyId: string
  isGenerating: boolean
  followGeneration: boolean
  onToggleFollowGeneration: () => void
  onGenerationStart: () => void
  onGenerationStream: (text: string) => void
  onGenerationComplete: () => void
  onGenerationError: () => void
}

export function InlineGenerationInput({
  storyId,
  isGenerating,
  followGeneration,
  onToggleFollowGeneration,
  onGenerationStart,
  onGenerationStream,
  onGenerationComplete,
  onGenerationError,
}: InlineGenerationInputProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    mutationFn: (data: { providerId?: string | null; modelId?: string | null }) =>
      api.settings.update(storyId, data),
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

  const handleGenerate = async () => {
    if (!input.trim() || isGenerating) return

    onGenerationStart()
    setError(null)

    try {
      const stream = await api.generation.generateAndSave(storyId, input)

      const reader = stream.getReader()
      let accumulated = ''
      let rafScheduled = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += value

        // Throttle state updates to animation frames (~60fps max)
        // instead of firing on every chunk (could be 100+)
        if (!rafScheduled) {
          rafScheduled = true
          const snapshot = accumulated
          requestAnimationFrame(() => {
            onGenerationStream(snapshot)
            rafScheduled = false
          })
        }
      }

      // Final flush with complete text
      onGenerationStream(accumulated)

      // Invalidate queries to refresh the prose view
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })

      // Clear input after successful generation
      setInput('')
      onGenerationComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
      onGenerationError()
    }
  }

  const handleStop = () => {
    onGenerationError()
  }

  // Resolve current model label
  const modelLabel = (() => {
    if (!globalConfig) return null
    const providers = globalConfig.providers.filter(p => p.enabled)
    if (story?.settings.providerId) {
      const p = providers.find(p => p.id === story.settings.providerId)
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
      {error && (
        <div className="text-sm text-destructive mb-3 font-sans">
          {error}
        </div>
      )}

      {/* Unified input container */}
      <div
        className={`relative rounded-xl border transition-all duration-300 ${
          isFocused
            ? 'border-primary/25 shadow-[0_0_0_1px_var(--primary)/8%,0_2px_12px_-2px_var(--primary)/6%] bg-card/60'
            : 'border-border/30 bg-card/20 hover:border-border/50 hover:bg-card/30'
        }`}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          data-component-id="inline-generation-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="What happens next..."
          rows={1}
          className="w-full resize-none bg-transparent border-none outline-none px-4 pt-3.5 pb-2 font-prose text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/30 placeholder:italic disabled:opacity-40"
          style={{ minHeight: '44px', maxHeight: '200px', overflowY: 'auto', scrollbarWidth: 'none' }}
          disabled={isGenerating}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              handleGenerate()
            }
          }}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
          {/* Left: Model selector + Follow toggle */}
          <div className="flex items-center gap-2">
            {globalConfig && (
              <div className="relative group/model">
                <select
                  data-component-id="inline-generation-provider-select"
                  value={story?.settings.providerId ?? ''}
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
                      : 'text-muted-foreground/30 hover:text-muted-foreground/50',
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
            {!isGenerating && (
              <span className="text-[10px] text-muted-foreground/30 font-sans select-none hidden sm:inline">
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
            ) : (
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
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
