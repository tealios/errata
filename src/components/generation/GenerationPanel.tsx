import { useState, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

interface GenerationPanelProps {
  storyId: string
  onBack?: () => void
}

export function GenerationPanel({ storyId, onBack }: GenerationPanelProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [streamedText, setStreamedText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

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

        // Auto-scroll to bottom
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight
        }
      }

      if (saveResult) {
        // Invalidate fragment queries to refresh the list
        queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
        setInput('')
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
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">Generate</h2>
        {onBack && (
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back to Story
          </Button>
        )}
      </div>

      {/* Streaming output area */}
      {streamedText && (
        <>
          <div ref={outputRef} className="flex-1 overflow-auto p-4">
            <div className="max-w-prose mx-auto">
              <div className="prose prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
                {streamedText}
              </div>
              {isGenerating && (
                <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse ml-0.5" />
              )}
            </div>
          </div>
          <Separator />
        </>
      )}

      {error && (
        <div className="px-4 py-2 text-sm text-destructive bg-destructive/10 border-b">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="p-4 space-y-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe what should happen next in the story..."
          className="min-h-[80px] resize-none text-sm"
          disabled={isGenerating}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              handleGenerate(true)
            }
          }}
        />
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
        <p className="text-[10px] text-muted-foreground">
          Ctrl+Enter to generate & save
        </p>
      </div>
    </div>
  )
}
