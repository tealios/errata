import { useState, useRef, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sparkles, Square, X } from 'lucide-react'
import { StreamMarkdown } from '@/components/ui/stream-markdown'

interface RefinementPanelProps {
  storyId: string
  fragmentId: string
  fragmentName: string
  onComplete?: () => void
  onClose: () => void
}

export function RefinementPanel({
  storyId,
  fragmentId,
  fragmentName,
  onComplete,
  onClose,
}: RefinementPanelProps) {
  const queryClient = useQueryClient()
  const [instructions, setInstructions] = useState('')
  const [streamedText, setStreamedText] = useState('')
  const [isRefining, setIsRefining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Stop the LLM call if the panel closes mid-refine
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const handleRefine = useCallback(async () => {
    if (isRefining) return

    const abortController = new AbortController()
    abortRef.current = abortController
    setIsRefining(true)
    setStreamedText('')
    setError(null)
    setDone(false)

    try {
      const stream = await api.librarian.refine(
        storyId,
        fragmentId,
        instructions.trim() || undefined,
        abortController.signal,
      )

      const reader = stream.getReader()
      let accumulated = ''
      let streamError: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'text') {
          accumulated += value.text
          setStreamedText(accumulated)
        } else if (value.type === 'error') {
          streamError = value.error
        }

        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight
        }
      }

      // Invalidate fragment queries to show updated content
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['fragment', storyId, fragmentId] })
      if (streamError) {
        setError(streamError)
        return
      }
      setDone(true)
      onComplete?.()
    } catch (err) {
      if (abortController.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
      setError(err instanceof Error ? err.message : 'Refinement failed')
    } finally {
      if (abortRef.current === abortController) abortRef.current = null
      setIsRefining(false)
    }
  }, [instructions, isRefining, storyId, fragmentId, queryClient, onComplete])

  return (
    <div className="border border-border/40 rounded-lg bg-card/30" data-component-id="refinement-root">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <div className="flex items-center gap-1.5 text-xs">
          <Sparkles className="size-3 text-primary/70" />
          <span className="font-medium">Refine</span>
          <span className="text-muted-foreground truncate max-w-[150px]">{fragmentName}</span>
        </div>
        <Button size="icon" variant="ghost" className="size-5 text-muted-foreground" onClick={onClose} data-component-id="refinement-close">
          <X className="size-3" />
        </Button>
      </div>

      <div className="p-3 space-y-2">
        {/* Instructions input */}
        {!isRefining && !done && (
          <>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Optional: describe how to improve this fragment..."
              className="min-h-[60px] resize-none text-xs bg-transparent placeholder:italic placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  handleRefine()
                }
              }}
              data-component-id="refinement-input"
            />
            <div className="flex items-center justify-between">
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleRefine}
                data-component-id="refinement-submit"
              >
                <Sparkles className="size-3" />
                Refine
              </Button>
              <span className="text-[0.625rem] text-muted-foreground">
                Ctrl+Enter to start
              </span>
            </div>
          </>
        )}

        {/* Streaming output */}
        {(isRefining || streamedText) && (
          <div ref={outputRef} className="max-h-[200px] overflow-auto">
            <div className="text-xs text-muted-foreground">
              <StreamMarkdown content={streamedText} streaming={isRefining} variant="prose" />
            </div>
          </div>
        )}

        {/* Stop button while refining */}
        {isRefining && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={onClose}
            data-component-id="refinement-stop"
          >
            <Square className="size-3" />
            Cancel
          </Button>
        )}

        {/* Error */}
        {error && (
          <div className="text-xs text-destructive bg-destructive/5 rounded-md p-2">
            {error}
          </div>
        )}

        {/* Done state */}
        {done && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-primary/70">Fragment updated</span>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onClose} data-component-id="refinement-done">
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
