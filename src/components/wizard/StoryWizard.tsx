import { useIsCoarsePointer } from '@/hooks/use-mobile'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Check, Circle, FileText, Minus, Square, X } from 'lucide-react'
import {
  api,
  type StorySetupChecklistItem,
  type StorySetupChecklistKey,
  type StorySetupDraftFragment,
  type StorySetupMessage,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { StreamMarkdown } from '@/components/ui/stream-markdown'
import { ErrataMark } from '@/components/ErrataLogo'
import { readStorySetupSession, writeStorySetupSession } from './story-setup-session'

interface StoryWizardProps {
  storyId: string
  onComplete: () => void
}

const STARTING_POINTS = [
  { label: 'A premise', message: 'I have a premise, but it is still rough.' },
  { label: 'A character', message: 'I want to begin with a character.' },
  { label: 'A scene', message: 'I have a scene I can picture.' },
  { label: 'Only a mood', message: 'I only have a mood or feeling so far.' },
] as const

const CHECKLIST: Array<{ key: StorySetupChecklistKey; label: string }> = [
  { key: 'starting-point', label: 'Starting point' },
  { key: 'premise', label: 'What it is about' },
  { key: 'characters', label: 'Characters' },
  { key: 'goal', label: 'Goal and stakes' },
  { key: 'setting', label: 'Setting' },
  { key: 'voice', label: 'Voice and tone' },
  { key: 'opening', label: 'Opening direction' },
]

const INITIAL_CHECKLIST: StorySetupChecklistItem[] = CHECKLIST.map(item => ({
  key: item.key,
  status: 'missing',
  note: '',
}))

function AssistantTurn({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return (
    <article className="flex items-start gap-3 sm:gap-4" data-component-id="story-setup-assistant-turn">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center text-primary/75" aria-hidden>
        <ErrataMark size={18} />
      </div>
      <div className="min-w-0 max-w-[70ch] flex-1 font-prose text-[0.975rem] leading-7 text-foreground/90 sm:text-base">
        <span className="sr-only">Errata: </span>
        {content ? (
          <StreamMarkdown content={content} streaming={streaming} variant="prose" />
        ) : (
          <div className="flex h-7 items-center gap-1.5 text-muted-foreground" aria-label="Errata is thinking">
            <span className="size-1 rounded-full bg-current motion-safe:animate-wisp-breathe" />
            <span className="size-1 rounded-full bg-current motion-safe:animate-wisp-breathe [animation-delay:180ms]" />
            <span className="size-1 rounded-full bg-current motion-safe:animate-wisp-breathe [animation-delay:360ms]" />
          </div>
        )}
      </div>
    </article>
  )
}

function WriterTurn({ content }: { content: string }) {
  return (
    <article className="ml-10 sm:ml-11" data-component-id="story-setup-writer-turn">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">You</p>
      <p className="max-w-[68ch] whitespace-pre-wrap rounded-lg bg-muted/45 px-4 py-3 font-prose text-[0.95rem] leading-6 text-foreground sm:text-base">
        {content}
      </p>
    </article>
  )
}

function ChecklistStatus({ status }: { status: StorySetupChecklistItem['status'] }) {
  if (status === 'covered') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-label="Covered">
        <Check className="size-2.5" aria-hidden />
      </span>
    )
  }
  if (status === 'partial') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary" aria-label="Partly covered">
        <Minus className="size-2.5" aria-hidden />
      </span>
    )
  }
  return <Circle className="size-4 shrink-0 text-muted-foreground/45" aria-label="Not covered yet" />
}

function StorySetupRail({
  checklist,
  draftFragments,
  updating,
}: {
  checklist: StorySetupChecklistItem[]
  draftFragments: StorySetupDraftFragment[]
  updating: boolean
}) {
  const covered = checklist.filter(item => item.status === 'covered').length
  const checklistByKey = new Map(checklist.map(item => [item.key, item]))

  return (
    <aside className="space-y-7 lg:sticky lg:top-8" data-component-id="story-setup-progress">
      <section aria-labelledby="story-checklist-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="story-checklist-heading" className="text-sm font-semibold text-foreground">Story checklist</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{covered} of {CHECKLIST.length}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">A guide for the conversation, not a requirement.</p>
        <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-1">
          {CHECKLIST.map(definition => {
            const item = checklistByKey.get(definition.key) ?? {
              key: definition.key,
              status: 'missing' as const,
              note: '',
            }
            return (
              <li key={definition.key} className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5"><ChecklistStatus status={item.status} /></span>
                <div className="min-w-0">
                  <p className={`text-xs leading-5 ${item.status === 'missing' ? 'text-muted-foreground' : 'text-foreground/85'}`}>
                    {definition.label}
                  </p>
                  {item.note && <p className="line-clamp-2 text-[0.6875rem] leading-4 text-muted-foreground">{item.note}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="draft-fragments-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="draft-fragments-heading" className="text-sm font-semibold text-foreground">Story fragments</h2>
          {updating && <span className="text-[0.6875rem] text-muted-foreground">Updating</span>}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Saved as the conversation develops. Open one to read it.</p>

        {draftFragments.length === 0 ? (
          <div className="mt-4 flex items-start gap-2.5 text-xs leading-5 text-muted-foreground">
            <FileText className="mt-0.5 size-4 shrink-0 opacity-50" aria-hidden />
            <p>Fragments will appear here as the idea takes shape.</p>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-border/30 border-y border-border/30">
            {draftFragments.map(fragment => (
              <details key={fragment.id ?? fragment.key} className="group py-3">
                <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground/90">{fragment.name}</p>
                      <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{fragment.type}</p>
                    </div>
                    <span className="mt-0.5 text-xs text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>›</span>
                  </div>
                  <p className="mt-1.5 text-[0.6875rem] leading-4 text-muted-foreground">{fragment.description}</p>
                </summary>
                <p className="mt-3 whitespace-pre-wrap font-prose text-xs leading-5 text-foreground/75">{fragment.content}</p>
              </details>
            ))}
          </div>
        )}
      </section>
    </aside>
  )
}

export function StoryWizard({ storyId, onComplete }: StoryWizardProps) {
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<StorySetupMessage[]>([])
  const [input, setInput] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checklist, setChecklist] = useState<StorySetupChecklistItem[]>(INITIAL_CHECKLIST)
  const [draftFragments, setDraftFragments] = useState<StorySetupDraftFragment[]>([])
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const initialRequestRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  const userTurnCount = messages.filter(message => message.role === 'user').length

  const requestAssistant = useCallback(async (history: StorySetupMessage[]) => {
    const controller = new AbortController()
    abortRef.current = controller
    setIsStreaming(true)
    setStreamingText('')
    setError(null)
    let accumulated = ''

    try {
      const stream = await api.storySetup.chat(storyId, history, controller.signal)
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'text') {
          accumulated += value.text
          setStreamingText(accumulated)
        } else if (value.type === 'tool-call' && value.toolName === 'updateStorySetup') {
          const snapshot = value.args as {
            checklist?: StorySetupChecklistItem[]
            fragments?: StorySetupDraftFragment[]
          }
          if (Array.isArray(snapshot.checklist)) {
            const incoming = new Map(snapshot.checklist.map(item => [item.key, item]))
            setChecklist(CHECKLIST.map(definition => incoming.get(definition.key) ?? {
              key: definition.key,
              status: 'missing',
              note: '',
            }))
          }
          if (Array.isArray(snapshot.fragments)) {
            setDraftFragments(snapshot.fragments)
          }
        } else if (value.type === 'tool-result' && value.toolName === 'updateStorySetup') {
          const saved = value.result as { fragments?: StorySetupDraftFragment[] }
          if (Array.isArray(saved.fragments)) {
            setDraftFragments(saved.fragments)
          }
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['story', storyId] }),
            queryClient.invalidateQueries({ queryKey: ['fragments', storyId] }),
            queryClient.invalidateQueries({ queryKey: ['wizard-fragments', storyId] }),
            queryClient.invalidateQueries({ queryKey: ['fragment-count', storyId] }),
            queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] }),
          ])
        }
      }
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') {
        setError(caught instanceof Error ? caught.message : 'Errata could not continue the conversation.')
      }
    } finally {
      if (accumulated.trim()) {
        setMessages([...history, { role: 'assistant', content: accumulated.trim() }])
      }
      setStreamingText('')
      setIsStreaming(false)
      abortRef.current = null
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [queryClient, storyId])

  useEffect(() => {
    const saved = readStorySetupSession(window.localStorage, storyId)
    if (saved) {
      const savedByKey = new Map(saved.checklist.map(item => [item.key, item]))
      setMessages(saved.messages)
      setChecklist(CHECKLIST.map(item => savedByKey.get(item.key) ?? { ...item, status: 'missing', note: '' }))
      setDraftFragments(saved.draftFragments)
    }
    setSessionLoaded(true)
  }, [storyId])

  useEffect(() => {
    if (!sessionLoaded) return
    if (initialRequestRef.current) return
    initialRequestRef.current = true
    if (messages.length === 0 || messages.at(-1)?.role === 'user') {
      requestAssistant(messages)
    }
    return () => abortRef.current?.abort()
  }, [messages, requestAssistant, sessionLoaded])

  useEffect(() => {
    if (!sessionLoaded) return
    writeStorySetupSession(window.localStorage, storyId, { messages, checklist, draftFragments })
  }, [checklist, draftFragments, messages, sessionLoaded, storyId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth', block: 'end' })
  }, [messages, streamingText, isStreaming])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`
  }, [input])

  const send = useCallback((content: string) => {
    const trimmed = content.trim()
    if (!trimmed || isStreaming) return
    const history: StorySetupMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(history)
    setInput('')
    requestAssistant(history)
  }, [isStreaming, messages, requestAssistant])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    send(input)
  }

  // Touch keyboards have no Shift+Enter: Enter makes a new line, the button sends.
  const isCoarsePointer = useIsCoarsePointer()
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !isCoarsePointer) {
      event.preventDefault()
      send(input)
    }
  }

  const handleClose = () => {
    abortRef.current?.abort()
    onComplete()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-component-id="story-setup-root">
      <header className="shrink-0 border-b border-border/25 bg-background/95 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <ErrataMark size={22} className="shrink-0 text-primary" />
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl italic leading-tight sm:text-2xl">Shape your story</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">Talk it through; your story takes shape as you go.</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={handleClose}>Open story</Button>
            <Button variant="ghost" size="icon-sm" onClick={handleClose} aria-label="Close story setup">
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto" data-component-id="story-setup-transcript">
            <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-8 sm:px-8 sm:py-12 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="order-2 space-y-8 lg:order-1" aria-live="polite">
                {messages.map((message, index) => message.role === 'assistant' ? (
                  <AssistantTurn key={`assistant-${index}`} content={message.content} />
                ) : (
                  <WriterTurn key={`user-${index}`} content={message.content} />
                ))}

                {isStreaming && <AssistantTurn content={streamingText} streaming={Boolean(streamingText)} />}

                {userTurnCount === 0 && !isStreaming && messages.some(message => message.role === 'assistant') && (
                  <div className="ml-10 space-y-3 sm:ml-11">
                    <p className="text-xs text-muted-foreground">You can start anywhere</p>
                    <div className="flex flex-wrap gap-2">
                      {STARTING_POINTS.map(point => (
                        <button
                          key={point.label}
                          type="button"
                          onClick={() => send(point.message)}
                          className="rounded-md border border-border/50 px-3 py-2 text-sm text-foreground/75 transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          {point.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="ml-10 rounded-lg bg-destructive/8 px-4 py-3 text-sm text-destructive sm:ml-11" role="alert">
                    <p>{error}</p>
                    <button
                      type="button"
                      onClick={() => requestAssistant(messages)}
                      className="mt-2 font-medium underline underline-offset-4 hover:no-underline"
                    >
                      Try the conversation again
                    </button>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              <div className="order-1 lg:order-2">
                <StorySetupRail checklist={checklist} draftFragments={draftFragments} updating={isStreaming} />
              </div>
            </div>
      </main>

      <footer className="shrink-0 border-t border-border/25 bg-background">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-3 sm:px-8 sm:py-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <form
            onSubmit={handleSubmit}
            className="min-w-0 lg:col-start-1"
            data-component-id="story-setup-composer-column"
          >
              <div className="flex items-end gap-2 rounded-xl border border-border/55 bg-card/25 p-2 focus-within:border-foreground/35">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={event => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isStreaming}
                  rows={1}
                  autoFocus
                  aria-label="Your story idea"
                  placeholder="Tell Errata whatever you have..."
                  className="max-h-44 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 font-prose text-base leading-6 shadow-none focus-visible:ring-0 placeholder:text-muted-foreground"
                />
                {isStreaming ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => abortRef.current?.abort()}
                    aria-label="Stop Errata"
                  >
                    <Square className="size-3 fill-current" aria-hidden />
                  </Button>
                ) : (
                  <Button type="submit" size="icon-sm" disabled={!input.trim()} aria-label="Send message">
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 px-1 text-[0.6875rem] text-muted-foreground">
                <p>Fragments are saved as the conversation develops.</p>
                <p className="hidden sm:block">Enter to send, Shift+Enter for a new line</p>
              </div>
          </form>
        </div>
      </footer>
    </div>
  )
}
