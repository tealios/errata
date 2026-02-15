import { useState, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { StreamMarkdown } from '@/components/ui/stream-markdown'
import { DebugPanel } from './DebugPanel'
import { Send, Eye, Square, Bug, ArrowLeft } from 'lucide-react'

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
  const [showDebug, setShowDebug] = useState(false)
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

        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight
        }
      }

      if (saveResult) {
        await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
        await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <h2 className="font-display text-lg">Generate</h2>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={showDebug ? 'secondary' : 'ghost'}
            className="h-7 text-xs gap-1"
            onClick={() => setShowDebug(!showDebug)}
          >
            <Bug className="size-3" />
            Debug
          </Button>
          {onBack && (
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={onBack}>
              <ArrowLeft className="size-3" />
              Back
            </Button>
          )}
        </div>
      </div>

      {showDebug ? (
        <DebugPanel
          storyId={storyId}
          onClose={() => setShowDebug(false)}
        />
      ) : (
        <>
          {/* Streaming output area */}
          {streamedText && (
            <>
              <div ref={outputRef} className="flex-1 overflow-auto px-6 py-6">
                <div className="max-w-[38rem] mx-auto">
                  <StreamMarkdown content={streamedText} streaming={isGenerating} />
                </div>
              </div>
              <div className="h-px bg-border/30" />
            </>
          )}

          {error && (
            <div className="px-6 py-2 text-sm text-destructive bg-destructive/5 border-b border-border/50">
              {error}
            </div>
          )}

          {/* Input area */}
          <div className="px-6 py-5 space-y-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe what should happen next in the story..."
              className="min-h-[80px] resize-none text-sm bg-transparent placeholder:italic placeholder:text-muted-foreground/40"
              disabled={isGenerating}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  handleGenerate(true)
                }
              }}
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {isGenerating ? (
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleStop}>
                    <Square className="size-3" />
                    Stop
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => handleGenerate(true)}
                      disabled={!input.trim()}
                    >
                      <Send className="size-3" />
                      Generate & Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1.5 text-muted-foreground"
                      onClick={() => handleGenerate(false)}
                      disabled={!input.trim()}
                    >
                      <Eye className="size-3" />
                      Preview
                    </Button>
                  </>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground/40">
                Ctrl+Enter to generate & save
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
