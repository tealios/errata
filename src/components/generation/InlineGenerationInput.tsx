import { useState, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface InlineGenerationInputProps {
  storyId: string
  onDebugLog?: (logId: string) => void
}

export function InlineGenerationInput({ storyId, onDebugLog }: InlineGenerationInputProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [streamedText, setStreamedText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamRef = useRef<HTMLDivElement>(null)

  const handleGenerate = useCallback(async (saveResult: boolean) => {
    if (!input.trim() || isGenerating) return

    setIsGenerating(true)
    setStreamedText('')
    setError(null)

    try {
      const stream = saveResult
        ? await api.generation.generateAndSave(storyId, input)
        : await api.generation.stream(storyId, input)

      const reader = stream.getReader()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += value
        setStreamedText(accumulated)

        if (streamRef.current) {
          streamRef.current.scrollTop = streamRef.current.scrollHeight
        }
      }

      if (saveResult) {
        queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
        setInput('')
        setStreamedText('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setIsGenerating(false)
    }
  }, [input, isGenerating, storyId, queryClient])

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsGenerating(false)
  }, [])

  return (
    <div className="border-t bg-background mt-4">
      {/* Streaming preview */}
      {streamedText && (
        <div ref={streamRef} className="max-h-[200px] overflow-auto px-6 pt-4">
          <div className="max-w-prose mx-auto">
            <div className="text-sm leading-relaxed font-serif whitespace-pre-wrap text-muted-foreground">
              {streamedText}
            </div>
            {isGenerating && (
              <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5" />
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-6 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="max-w-prose mx-auto px-6 py-4">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What happens next..."
          className="min-h-[60px] max-h-[150px] resize-none text-sm border-muted"
          disabled={isGenerating}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              handleGenerate(true)
            }
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <div className="flex gap-2">
            {isGenerating ? (
              <Button variant="destructive" size="sm" onClick={handleStop}>
                Stop
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={() => handleGenerate(true)}
                  disabled={!input.trim()}
                >
                  Generate & Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleGenerate(false)}
                  disabled={!input.trim()}
                >
                  Preview
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {onDebugLog && (
              <button
                onClick={() => onDebugLog('')}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Debug
              </button>
            )}
            <span className="text-[10px] text-muted-foreground">
              Ctrl+Enter to generate & save
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
