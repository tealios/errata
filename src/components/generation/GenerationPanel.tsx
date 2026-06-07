import { useState, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { StreamMarkdown } from '@/components/ui/stream-markdown'
import {
  Panel,
  PanelActions,
  PanelHeader,
  PanelHeaderText,
  PanelTitle,
} from '@/components/ui/panel'
import { DebugPanel } from './DebugPanel'
import { QuestionCard } from './QuestionCard'
import { Send, Eye, Square, Bug, ArrowLeft } from 'lucide-react'
import type { ClarifyQuestion, Clarification } from '@/lib/api/types'

interface GenerationPanelProps {
  storyId: string
  onBack?: () => void
}

// A round number high enough that the server withholds the ask tool and must
// write — used by "Skip & write" to proceed without answering.
const FORCE_PROCEED_ROUND = 99

export function GenerationPanel({ storyId, onBack }: GenerationPanelProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [streamedText, setStreamedText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [pendingQuestions, setPendingQuestions] = useState<ClarifyQuestion[] | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  // In-flight generation context, preserved across the clarify round trip.
  const genCtxRef = useRef<{ input: string; saveResult: boolean; clarifications: Clarification[]; round: number }>({
    input: '',
    saveResult: true,
    clarifications: [],
    round: 0,
  })

  const runGeneration = useCallback(async (
    genInput: string,
    saveResult: boolean,
    clarifications: Clarification[],
    round: number,
  ) => {
    if (!genInput.trim()) return

    setIsGenerating(true)
    setError(null)
    setPendingQuestions(null)
    if (round === 0) setStreamedText('')
    // Preserve the prompt that started this round so answering/skipping reruns
    // against it, even if the author edits the textarea while questions show.
    genCtxRef.current = { input: genInput, saveResult, clarifications, round }

    const ac = new AbortController()
    abortRef.current = ac

    let asked: ClarifyQuestion[] | null = null
    try {
      const opts = clarifications.length || round > 0
        ? { clarifications, clarifyRound: round }
        : undefined
      const stream = saveResult
        ? await api.generation.generateAndSave(storyId, genInput, ac.signal, opts)
        : await api.generation.stream(storyId, genInput, ac.signal, opts)

      const reader = stream.getReader()
      let accumulated = ''
      let rafScheduled = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'text') {
          accumulated += value.text
        } else if (value.type === 'clarify-questions') {
          asked = value.questions
        }

        if (!rafScheduled && accumulated) {
          rafScheduled = true
          const snapshot = accumulated
          requestAnimationFrame(() => {
            setStreamedText(snapshot)
            if (outputRef.current) {
              outputRef.current.scrollTop = outputRef.current.scrollHeight
            }
            rafScheduled = false
          })
        }
      }

      if (asked) {
        setPendingQuestions(asked)
        return // wait for the author's answers before finalizing
      }

      setStreamedText(accumulated)
      if (saveResult) {
        await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
        await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
        setInput('')
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Generation failed')
      }
    } finally {
      setIsGenerating(false)
      abortRef.current = null
    }
  }, [storyId, queryClient])

  const handleGenerate = useCallback((saveResult: boolean) => {
    if (isGenerating) return
    runGeneration(input, saveResult, [], 0)
  }, [isGenerating, runGeneration, input])

  const handleAnswers = useCallback((answers: Clarification[]) => {
    const { input: gi, saveResult, clarifications, round } = genCtxRef.current
    runGeneration(gi, saveResult, [...clarifications, ...answers], round + 1)
  }, [runGeneration])

  const handleSkipQuestions = useCallback(() => {
    const { input: gi, saveResult, clarifications } = genCtxRef.current
    runGeneration(gi, saveResult, clarifications, FORCE_PROCEED_ROUND)
  }, [runGeneration])

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsGenerating(false)
    setPendingQuestions(null)
  }, [])

  return (
    <Panel data-component-id="generation-panel-root">
      <PanelHeader>
        <PanelHeaderText>
          <PanelTitle>Generate</PanelTitle>
        </PanelHeaderText>
        <PanelActions>
          <Button
            size="sm"
            variant={showDebug ? 'secondary' : 'ghost'}
            className="h-7 text-xs gap-1"
            onClick={() => setShowDebug(!showDebug)}
            data-component-id="generation-debug-toggle"
          >
            <Bug className="size-3" />
            Debug
          </Button>
          {onBack && (
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={onBack} data-component-id="generation-back">
              <ArrowLeft className="size-3" />
              Back
            </Button>
          )}
        </PanelActions>
      </PanelHeader>

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
              <div ref={outputRef} className="flex-1 overflow-auto px-6 py-6" data-component-id="generation-output">
                <div className="max-w-[38rem] mx-auto">
                  <StreamMarkdown content={streamedText} streaming={isGenerating} variant="prose" />
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

          {/* Clarifying questions from the prewriter */}
          {pendingQuestions && (
            <QuestionCard
              questions={pendingQuestions}
              onSubmit={handleAnswers}
              onCancel={handleSkipQuestions}
              disabled={isGenerating}
            />
          )}

          {/* Input area */}
          <div className="px-6 py-5 space-y-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe what should happen next in the story..."
              className="min-h-[80px] resize-none text-sm bg-transparent placeholder:italic placeholder:text-muted-foreground"
              disabled={isGenerating}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  handleGenerate(true)
                }
              }}
              data-component-id="generation-input"
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {isGenerating ? (
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleStop} data-component-id="generation-stop">
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
                      data-component-id="generation-submit"
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
                      data-component-id="generation-preview"
                    >
                      <Eye className="size-3" />
                      Preview
                    </Button>
                  </>
                )}
              </div>
              <span className="text-[0.625rem] text-muted-foreground">
                Ctrl+Enter to generate & save
              </span>
            </div>
          </div>
        </>
      )}
    </Panel>
  )
}
