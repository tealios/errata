import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Sparkles, Square, ChevronLeft, ChevronRight,
  Plus, Trash2, Check, Pen, Bot, Users, PenLine,
  RefreshCw, BookOpen, Layers, Eye, Zap,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────

interface StoryWizardProps {
  storyId: string
  onComplete: () => void
}

type WizardStep = 'concept' | 'guideline' | 'world' | 'characters' | 'preferences' | 'prose' | 'complete'

const STEPS: WizardStep[] = ['concept', 'guideline', 'world', 'characters', 'preferences', 'prose', 'complete']

const STEP_QUESTIONS: Record<WizardStep, { question: string; subtitle: string }> = {
  concept:     { question: 'Begin your story',            subtitle: 'Give it a name and a spark of inspiration.' },
  guideline:   { question: 'How should it be written?',   subtitle: 'Define the voice, tone, and style that shapes your prose.' },
  world:       { question: 'Where does it take place?',   subtitle: 'Paint the world your characters inhabit.' },
  characters:  { question: 'Who inhabits your story?',    subtitle: 'Create the cast that brings your world to life.' },
  preferences: { question: 'How should Errata help you?', subtitle: 'Set up the AI assistant that works alongside your writing.' },
  prose:       { question: 'How does it begin?',          subtitle: 'Write or generate the opening words.' },
  complete:    { question: 'Your story is ready.',         subtitle: 'Everything you created is saved and editable from the sidebar.' },
}

interface CharData {
  name: string
  description: string
  content: string
  fragmentId: string | null
}

// ── useGenerate hook ───────────────────────────────────

function useGenerate(storyId: string) {
  const [text, setText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<import('@/lib/api/types').ChatEvent> | null>(null)

  const generate = useCallback(async (input: string) => {
    setIsStreaming(true)
    setError(null)
    setText('')

    try {
      const stream = await api.generation.stream(storyId, input)
      const reader = stream.getReader()
      readerRef.current = reader
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'text') {
          accumulated += value.text
          setText(accumulated)
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Generation failed')
      }
    } finally {
      readerRef.current = null
      setIsStreaming(false)
    }
  }, [storyId])

  const stop = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.cancel()
      readerRef.current = null
    }
    setIsStreaming(false)
  }, [])

  const clear = useCallback(() => {
    setText('')
    setError(null)
  }, [])

  return { text, setText, isStreaming, error, generate, stop, clear }
}

// ── WizardShell ──────────────────────────────────────────

function WizardShell({
  step,
  onSkip,
  children,
}: {
  step: WizardStep
  onSkip: () => void
  children: React.ReactNode
}) {
  const stepIndex = STEPS.indexOf(step)
  const progress = stepIndex / (STEPS.length - 1)
  const q = STEP_QUESTIONS[step]
  const showStepCount = step !== 'concept' && step !== 'complete'

  return (
    <div className="flex flex-col h-full" data-component-id="wizard-root">
      {/* Progress bar */}
      <div className="h-0.5 bg-border/20">
        <div
          className="h-full bg-primary/50 transition-all duration-500 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
          {showStepCount ? `Step ${stepIndex} of ${STEPS.length - 2}` : '\u00a0'}
        </span>
        <button
          onClick={onSkip}
          className="text-[11px] text-muted-foreground hover:text-muted-foreground transition-colors"
          data-component-id="wizard-skip"
        >
          Skip setup
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto" key={step}>
        <div className="animate-wizard-step-enter max-w-xl mx-auto px-5 py-4 sm:px-8 sm:py-8">
          {/* Question heading */}
          <div className="mb-8">
            <h2 className="font-display text-2xl sm:text-3xl italic leading-tight">
              {q.question}
            </h2>
            {q.subtitle && (
              <p className="font-prose text-sm text-muted-foreground mt-2 leading-relaxed">
                {q.subtitle}
              </p>
            )}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Shared components ──────────────────────────────────

function GenerateBar({
  placeholder,
  isStreaming,
  onGenerate,
  onStop,
  buttonLabel,
}: {
  placeholder: string
  isStreaming: boolean
  onGenerate: (instruction: string) => void
  onStop: () => void
  buttonLabel?: string
}) {
  const [instruction, setInstruction] = useState('')

  const handleSubmit = () => {
    onGenerate(instruction)
    setInstruction('')
  }

  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl border border-primary/15 bg-primary/[0.03]">
      <Sparkles className="size-4 text-primary/40 shrink-0" />
      <Input
        value={instruction}
        onChange={e => setInstruction(e.target.value)}
        placeholder={placeholder}
        className="flex-1 h-8 text-sm bg-transparent border-0 shadow-none focus-visible:ring-0"
        disabled={isStreaming}
        onKeyDown={e => {
          if (e.key === 'Enter' && !isStreaming) {
            e.preventDefault()
            handleSubmit()
          }
        }}
      />
      {isStreaming ? (
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 shrink-0" onClick={onStop}>
          <Square className="size-3" /> Stop
        </Button>
      ) : (
        <Button size="sm" className="h-7 text-xs gap-1.5 shrink-0" onClick={handleSubmit}>
          <Sparkles className="size-3" /> {buttonLabel || 'Generate'}
        </Button>
      )}
    </div>
  )
}

function ContentPreview({
  content,
  isStreaming,
  fontClass = 'font-prose',
  charLimit,
}: {
  content: string
  isStreaming: boolean
  fontClass?: string
  charLimit?: { min: number; max: number }
}) {
  return (
    <div className="relative">
      <div className={`p-4 rounded-xl border border-border/30 bg-card/20 ${fontClass} text-sm leading-relaxed whitespace-pre-wrap min-h-[140px] max-h-[400px] overflow-auto`}>
        {content || (
          <span className="text-muted-foreground italic">Generating...</span>
        )}
        {isStreaming && (
          <span className="inline-block w-0.5 h-4 bg-primary animate-wizard-cursor ml-0.5 align-text-bottom" />
        )}
      </div>
      {charLimit && content && (
        <div className={`text-[10px] mt-1 text-right ${
          content.length < charLimit.min ? 'text-muted-foreground' :
          content.length > charLimit.max ? 'text-destructive' :
          'text-muted-foreground'
        }`}>
          {content.length} / {charLimit.min}&ndash;{charLimit.max}
        </div>
      )}
    </div>
  )
}

function StepNav({
  onBack,
  onContinue,
  canContinue = true,
  continueLabel = 'Continue',
  showBack = true,
}: {
  onBack?: () => void
  onContinue: () => void
  canContinue?: boolean
  continueLabel?: string
  showBack?: boolean
}) {
  return (
    <div className="flex items-center justify-between mt-10 pt-4 border-t border-border/20">
      {showBack && onBack ? (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={onBack}
        >
          <ChevronLeft className="size-3.5" /> Back
        </Button>
      ) : <div />}
      <Button
        size="sm"
        className="gap-1.5"
        onClick={onContinue}
        disabled={!canContinue}
      >
        {continueLabel} <ChevronRight className="size-3.5" />
      </Button>
    </div>
  )
}

// ── ConceptStep ────────────────────────────────────────

function ConceptStep({
  storyId,
  storyName,
  setStoryName,
  storyDesc,
  setStoryDesc,
  onContinue,
  onSkip,
}: {
  storyId: string
  storyName: string
  setStoryName: (v: string) => void
  storyDesc: string
  setStoryDesc: (v: string) => void
  onContinue: () => void
  onSkip: () => void
}) {
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const { data: globalConfig } = useQuery({
    queryKey: ['global-config'],
    queryFn: () => api.config.getProviders(),
  })
  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
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

  const enabledProviders = globalConfig?.providers.filter(p => p.enabled) ?? []
  const showProviderPicker = enabledProviders.length > 1 ||
    (enabledProviders.length === 1 && !globalConfig?.defaultProviderId)

  const handleContinue = async () => {
    setSaving(true)
    try {
      await api.stories.update(storyId, {
        name: storyName.trim() || 'Untitled Story',
        description: storyDesc.trim(),
      })
    } catch {
      // best-effort
    }
    setSaving(false)
    onContinue()
  }

  return (
    <WizardShell step="concept" onSkip={onSkip}>
      <div className="space-y-6">
        <div>
          <Input
            value={storyName}
            onChange={e => setStoryName(e.target.value)}
            className="bg-transparent font-display text-lg italic border-border/40 h-12"
            placeholder="Untitled Story"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-2 block font-prose">
            A theme, a world, a feeling &mdash; this guides AI generation throughout.
          </label>
          <Textarea
            value={storyDesc}
            onChange={e => setStoryDesc(e.target.value)}
            className="min-h-[100px] text-sm bg-transparent font-prose resize-none border-border/40"
            placeholder="A noir detective story set in a rain-soaked city where memories can be extracted and sold..."
          />
        </div>

        {showProviderPicker && globalConfig && (
          <div>
            <label className="text-xs text-muted-foreground mb-2 block font-prose">
              Model provider for generation
            </label>
            <div className="flex items-center gap-2 p-2.5 rounded-xl border border-border/40 bg-card/30">
              <Bot className="size-4 text-muted-foreground shrink-0" />
              <select
                value={story?.settings.modelOverrides?.generation?.providerId ?? ''}
                onChange={e => {
                  const providerId = e.target.value || null
                  providerMutation.mutate({ providerId, modelId: null })
                }}
                disabled={providerMutation.isPending}
                className="flex-1 text-sm bg-transparent border-none outline-none cursor-pointer appearance-none pr-4"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 0 center',
                }}
              >
                {(() => {
                  const defaultProvider = globalConfig.defaultProviderId
                    ? enabledProviders.find(p => p.id === globalConfig.defaultProviderId)
                    : null
                  return (
                    <>
                      <option value="">
                        {defaultProvider
                          ? `${defaultProvider.name} \u00b7 ${defaultProvider.defaultModel}`
                          : 'DeepSeek (env) \u00b7 deepseek-chat'}
                      </option>
                      {enabledProviders
                        .filter(p => p.id !== globalConfig.defaultProviderId)
                        .map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} &middot; {p.defaultModel}
                          </option>
                        ))}
                    </>
                  )
                })()}
              </select>
            </div>
          </div>
        )}
      </div>

      <StepNav
        onContinue={handleContinue}
        canContinue={!saving}
        showBack={false}
      />
    </WizardShell>
  )
}

// ── ContentStep (guideline / world / prose) ────────────

type ContentPhase = 'choose' | 'write' | 'generate' | 'review'

function ContentStep({
  storyId,
  step,
  content,
  setContent,
  fragmentId,
  onContinue,
  onBack,
  onSkip,
  onSaved,
  storyDesc,
}: {
  storyId: string
  step: 'guideline' | 'world' | 'prose'
  content: string
  setContent: (v: string) => void
  fragmentId: string | null
  onContinue: () => void
  onBack: () => void
  onSkip: () => void
  onSaved: (id: string) => void
  storyDesc: string
}) {
  const queryClient = useQueryClient()
  const gen = useGenerate(storyId)
  const [saving, setSaving] = useState(false)
  const [phase, setPhase] = useState<ContentPhase>(content.trim() ? 'review' : 'choose')
  const fragmentIdRef = useRef(fragmentId)

  useEffect(() => { fragmentIdRef.current = fragmentId }, [fragmentId])

  // Sync streaming text into content
  useEffect(() => {
    if (gen.text) setContent(gen.text)
  }, [gen.text, setContent])

  // When generation completes: auto-save and move to review
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    const was = wasStreamingRef.current
    wasStreamingRef.current = gen.isStreaming

    if (was && !gen.isStreaming && gen.text.trim()) {
      saveFragment(gen.text).then(id => {
        if (id) onSaved(id)
      })
      setPhase('review')
    }
  }, [gen.isStreaming]) // eslint-disable-line react-hooks/exhaustive-deps

  const buildPrompt = (instruction: string) => {
    const hasExisting = content.trim().length > 0 && !gen.isStreaming

    if (hasExisting && instruction.trim()) {
      return `[WIZARD SETUP — NOT a prose request]\nRefine the following ${step} based on the feedback below. Maintain format and purpose but incorporate the requested changes. Output ONLY the refined text.\n\nCurrent text:\n---\n${content}\n---\n\nRequested changes: ${instruction}`
    }

    const storyContext = storyDesc ? `\nStory concept: ${storyDesc}` : ''

    if (step === 'guideline') {
      return `[WIZARD SETUP — NOT a prose request]\nGenerate a concise writing guideline for this story. Define: narrative tone, prose style, point of view, pacing approach, and any literary techniques to use. Output between 500-2000 characters. Output ONLY the guideline text.${storyContext}${instruction ? `\n${instruction}` : ''}`
    }
    if (step === 'world') {
      return `[WIZARD SETUP — NOT a prose request]\nGenerate a world setting description for this story. Cover: setting, time period, geography, culture, rules/magic systems, atmosphere. Be evocative but concise. Output ONLY the setting text.${storyContext}${instruction ? `\n${instruction}` : ''}`
    }
    return `Write an opening scene for this story. Use the established writing guidelines, incorporate the world and characters. Create an engaging, immersive opening that hooks the reader.${storyContext}${instruction ? `\n${instruction}` : ''}`
  }

  const handleGenerate = (instruction: string) => {
    gen.generate(buildPrompt(instruction))
  }

  const saveFragment = useCallback(async (textToSave: string): Promise<string | null> => {
    if (!textToSave.trim()) return fragmentIdRef.current

    setSaving(true)
    try {
      const typeMap = { guideline: 'guideline', world: 'knowledge', prose: 'prose' } as const
      const fragType = typeMap[step]
      const nameMap = { guideline: 'Writing Guideline', world: 'World Setting', prose: 'Opening' } as const
      const descMap = { guideline: 'Core writing style and tone', world: 'World and setting details', prose: 'Story opening' } as const

      let savedId = fragmentIdRef.current
      if (savedId) {
        await api.fragments.update(storyId, savedId, {
          name: nameMap[step],
          description: descMap[step],
          content: textToSave.trim(),
        })
      } else {
        const created = await api.fragments.create(storyId, {
          type: fragType,
          name: nameMap[step],
          description: descMap[step],
          content: textToSave.trim(),
        })
        savedId = created.id

        if (step === 'guideline') {
          await api.fragments.toggleSticky(storyId, savedId, true)
          await api.fragments.setPlacement(storyId, savedId, 'system')
        } else if (step === 'world') {
          await api.fragments.toggleSticky(storyId, savedId, true)
        } else if (step === 'prose') {
          await api.proseChain.addSection(storyId, savedId)
        }
      }

      fragmentIdRef.current = savedId
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      setSaving(false)
      return savedId
    } catch {
      setSaving(false)
      return fragmentIdRef.current
    }
  }, [storyId, step, queryClient])

  const handleContinue = async () => {
    if (content.trim()) {
      const savedId = await saveFragment(content)
      if (savedId) onSaved(savedId)
    }
    onContinue()
  }

  const generatePlaceholder = {
    guideline: 'Describe the tone you want, or leave empty to auto-generate...',
    world:     'Describe the world or setting...',
    prose:     'Describe how the story should open...',
  }

  const writePlaceholder = {
    guideline: 'Write in a dark, lyrical tone with close third-person POV...',
    world:     'A vast kingdom nestled between mountain ranges...',
    prose:     'The rain fell in sheets against the windowpane...',
  }

  const charLimit = step === 'guideline' ? { min: 500, max: 2000 } : undefined

  return (
    <WizardShell step={step} onSkip={onSkip}>
      {/* Phase: Choose */}
      {phase === 'choose' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setPhase('generate')}
              className="group text-left p-5 rounded-xl border-2 border-primary/15 hover:border-primary/35 bg-primary/[0.02] hover:bg-primary/[0.05] transition-all duration-200"
            >
              <Sparkles className="size-5 text-primary/60 mb-3" />
              <div className="font-display text-base italic">Generate</div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Let AI create it based on your story concept
              </p>
            </button>
            <button
              onClick={() => setPhase('write')}
              className="group text-left p-5 rounded-xl border-2 border-border/40 hover:border-foreground/15 bg-card/20 hover:bg-card/40 transition-all duration-200"
            >
              <PenLine className="size-5 text-muted-foreground mb-3" />
              <div className="font-display text-base italic">Write</div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Write it yourself from scratch
              </p>
            </button>
          </div>
        </div>
      )}

      {/* Phase: Generate */}
      {phase === 'generate' && (
        <div className="space-y-4 animate-wizard-reveal">
          <GenerateBar
            placeholder={content.trim()
              ? `Describe how to refine this...`
              : generatePlaceholder[step]}
            isStreaming={gen.isStreaming}
            onGenerate={handleGenerate}
            onStop={gen.stop}
            buttonLabel={content.trim() ? 'Refine' : 'Generate'}
          />

          {(gen.isStreaming || content.trim()) && (
            <ContentPreview
              content={content}
              isStreaming={gen.isStreaming}
              fontClass={step === 'prose' ? 'prose-content' : 'font-prose'}
              charLimit={charLimit}
            />
          )}

          {gen.error && (
            <p className="text-xs text-destructive">{gen.error}</p>
          )}
        </div>
      )}

      {/* Phase: Write */}
      {phase === 'write' && (
        <div className="space-y-2 animate-wizard-reveal">
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={writePlaceholder[step]}
            className={`min-h-[200px] text-sm bg-transparent resize-none border-border/40 ${
              step === 'prose' ? 'prose-content' : 'font-prose'
            }`}
          />
          {charLimit && (
            <div className={`text-[10px] text-right ${
              content.length < charLimit.min ? 'text-muted-foreground' :
              content.length > charLimit.max ? 'text-destructive' :
              'text-muted-foreground'
            }`}>
              {content.length} / {charLimit.min}&ndash;{charLimit.max}
            </div>
          )}
        </div>
      )}

      {/* Phase: Review */}
      {phase === 'review' && (
        <div className="space-y-4 animate-wizard-reveal">
          <ContentPreview
            content={content}
            isStreaming={false}
            fontClass={step === 'prose' ? 'prose-content' : 'font-prose'}
            charLimit={charLimit}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setPhase('write')}
            >
              <Pen className="size-3" /> Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setPhase('generate')}
            >
              <RefreshCw className="size-3" /> Refine
            </Button>
          </div>
        </div>
      )}

      <StepNav
        onBack={onBack}
        onContinue={handleContinue}
        canContinue={!saving && !gen.isStreaming}
        continueLabel={saving ? 'Saving...' : 'Continue'}
      />
    </WizardShell>
  )
}

// ── CharactersStep ─────────────────────────────────────

function parseCastList(text: string): Array<{ name: string; description: string }> {
  const results: Array<{ name: string; description: string }> = []
  const lines = text.split('\n').filter(l => l.trim())
  for (const line of lines) {
    const cleaned = line.replace(/^\s*[-*\d.)\]]+\s*/, '').trim()
    if (!cleaned) continue
    const separatorMatch = cleaned.match(/^(.+?)\s*[—–:\-]\s+(.+)$/)
    if (separatorMatch) {
      const name = separatorMatch[1].replace(/\*\*/g, '').trim()
      const desc = separatorMatch[2].replace(/\*\*/g, '').trim()
      if (name && name.length < 60) {
        results.push({ name, description: desc })
      }
    }
  }
  return results
}

type CharPhase = 'choose' | 'cast' | 'manual'

function CharactersStep({
  storyId,
  characters,
  setCharacters,
  onContinue,
  onBack,
  onSkip,
  storyDesc,
}: {
  storyId: string
  characters: CharData[]
  setCharacters: (chars: CharData[]) => void
  onContinue: () => void
  onBack: () => void
  onSkip: () => void
  storyDesc: string
}) {
  const queryClient = useQueryClient()
  const castGen = useGenerate(storyId)
  const [phase, setPhase] = useState<CharPhase>(characters.length > 0 ? 'manual' : 'choose')
  const [saving, setSaving] = useState(false)

  // Cast preview
  const [castParsed, setCastParsed] = useState<Array<{ name: string; description: string; selected: boolean }>>([])
  const [showCastPreview, setShowCastPreview] = useState(false)

  // Manual form
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  // Editing existing character
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  // When cast generation completes, parse results
  useEffect(() => {
    if (castGen.text && !castGen.isStreaming) {
      const parsed = parseCastList(castGen.text)
      if (parsed.length > 0) {
        setCastParsed(parsed.map(p => ({ ...p, selected: true })))
        setShowCastPreview(true)
      }
    }
  }, [castGen.text, castGen.isStreaming])

  const handleGenerateCast = (instruction: string) => {
    const storyContext = storyDesc ? `\nStory concept: ${storyDesc}` : ''
    const existingChars = characters.length > 0
      ? `\nExisting characters: ${characters.map(c => c.name).join(', ')}`
      : ''
    castGen.generate(`[WIZARD SETUP — NOT a prose request]\nGenerate a cast of characters for this story. For each character, provide their name and a brief description focusing ONLY on personality and appearance. Keep descriptions simple and concise.\n\nFormat each character on its own line as:\nName — brief personality and appearance\n\nGenerate 3-6 characters. Output ONLY the character list, no extra text.${storyContext}${existingChars}${instruction ? `\n${instruction}` : ''}`)
  }

  const handleAcceptCast = async () => {
    const selected = castParsed.filter(c => c.selected)
    setSaving(true)

    const newChars: CharData[] = []
    for (const c of selected) {
      try {
        const created = await api.fragments.create(storyId, {
          type: 'character',
          name: c.name,
          description: c.description.slice(0, 250),
          content: `${c.name} — ${c.description}`,
        })
        await api.fragments.toggleSticky(storyId, created.id, true)

        newChars.push({
          name: c.name,
          description: c.description,
          content: `${c.name} — ${c.description}`,
          fragmentId: created.id,
        })
      } catch {
        newChars.push({
          name: c.name,
          description: c.description,
          content: `${c.name} — ${c.description}`,
          fragmentId: null,
        })
      }
    }

    setCharacters([...characters, ...newChars])
    await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    setSaving(false)
    setShowCastPreview(false)
    setCastParsed([])
    castGen.clear()
    setPhase('manual')
  }

  const handleAddManual = async () => {
    if (!newName.trim()) return
    setSaving(true)

    const charName = newName.trim()
    const charDesc = newDesc.trim() || charName

    try {
      const created = await api.fragments.create(storyId, {
        type: 'character',
        name: charName,
        description: charDesc.slice(0, 250),
        content: charDesc,
      })
      await api.fragments.toggleSticky(storyId, created.id, true)

      setCharacters([...characters, {
        name: charName,
        description: charDesc,
        content: charDesc,
        fragmentId: created.id,
      }])
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    } catch {
      setCharacters([...characters, {
        name: charName,
        description: charDesc,
        content: charDesc,
        fragmentId: null,
      }])
    }

    setNewName('')
    setNewDesc('')
    setSaving(false)
  }

  const handleDeleteCharacter = async (index: number) => {
    const char = characters[index]
    if (char.fragmentId) {
      try {
        await api.fragments.delete(storyId, char.fragmentId)
        await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      } catch {
        // best-effort
      }
    }
    setCharacters(characters.filter((_, i) => i !== index))
    if (editingIndex === index) {
      setEditingIndex(null)
    }
  }

  const handleStartEdit = (index: number) => {
    setEditingIndex(index)
    setEditName(characters[index].name)
    setEditDesc(characters[index].description)
  }

  const handleSaveEdit = async () => {
    if (editingIndex === null || !editName.trim()) return
    setSaving(true)

    const char = characters[editingIndex]
    const charName = editName.trim()
    const charDesc = editDesc.trim() || charName

    try {
      if (char.fragmentId) {
        await api.fragments.update(storyId, char.fragmentId, {
          name: charName,
          description: charDesc.slice(0, 250),
          content: charDesc,
        })
      }

      const updated = [...characters]
      updated[editingIndex] = {
        ...char,
        name: charName,
        description: charDesc,
        content: charDesc,
      }
      setCharacters(updated)
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    } catch {
      // best-effort
    }

    setSaving(false)
    setEditingIndex(null)
  }

  const isBusy = castGen.isStreaming || saving

  return (
    <WizardShell step="characters" onSkip={onSkip}>
      <div className="space-y-5">

        {/* Character list */}
        {characters.length > 0 && (
          <div className="space-y-2">
            {characters.map((char, i) => (
              <div
                key={char.fragmentId ?? `char-${char.name}`}
                className={`group p-3 rounded-xl border transition-colors ${
                  editingIndex === i
                    ? 'border-primary/25 bg-primary/[0.03]'
                    : 'border-border/30 bg-card/20 hover:border-border/50'
                }`}
              >
                {editingIndex === i ? (
                  /* Inline edit form */
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                        Name
                      </label>
                      <Input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="bg-transparent text-sm h-9 border-border/40"
                        placeholder="Character name"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                        Description
                      </label>
                      <Textarea
                        value={editDesc}
                        onChange={e => setEditDesc(e.target.value)}
                        className="min-h-[80px] text-sm bg-transparent font-prose resize-none border-border/40"
                        placeholder="Brief character description..."
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => setEditingIndex(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="text-xs gap-1"
                        onClick={handleSaveEdit}
                        disabled={!editName.trim() || saving}
                      >
                        {saving ? 'Saving...' : <><Check className="size-3" /> Save</>}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Character card */
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{char.name}</span>
                        {char.fragmentId && (
                          <Check className="size-3 text-primary/50 shrink-0" />
                        )}
                      </div>
                      {char.description && char.description !== char.name && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 font-prose">
                          {char.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => handleStartEdit(i)}
                        disabled={isBusy}
                      >
                        <Pen className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive/60 hover:text-destructive"
                        onClick={() => handleDeleteCharacter(i)}
                        disabled={isBusy}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Phase: Choose */}
        {phase === 'choose' && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setPhase('cast')}
              className="group text-left p-5 rounded-xl border-2 border-primary/15 hover:border-primary/35 bg-primary/[0.02] hover:bg-primary/[0.05] transition-all duration-200"
            >
              <Users className="size-5 text-primary/60 mb-3" />
              <div className="font-display text-base italic">Generate a Cast</div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Let AI suggest characters that fit your story
              </p>
            </button>
            <button
              onClick={() => setPhase('manual')}
              className="group text-left p-5 rounded-xl border-2 border-border/40 hover:border-foreground/15 bg-card/20 hover:bg-card/40 transition-all duration-200"
            >
              <Plus className="size-5 text-muted-foreground mb-3" />
              <div className="font-display text-base italic">Add One by One</div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Create characters manually with name and description
              </p>
            </button>
          </div>
        )}

        {/* Phase: Cast generation */}
        {phase === 'cast' && (
          <div className="space-y-4 animate-wizard-reveal">
            {!showCastPreview && (
              <GenerateBar
                placeholder="Describe the cast you need, or leave empty..."
                isStreaming={castGen.isStreaming}
                onGenerate={handleGenerateCast}
                onStop={castGen.stop}
                buttonLabel="Generate Cast"
              />
            )}

            {castGen.isStreaming && castGen.text && (
              <ContentPreview
                content={castGen.text}
                isStreaming={true}
              />
            )}

            {castGen.error && (
              <p className="text-xs text-destructive">{castGen.error}</p>
            )}

            {/* Cast preview with checkboxes */}
            {showCastPreview && castParsed.length > 0 && (
              <div className="space-y-2">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Select characters to add
                </label>
                {castParsed.map((char, i) => (
                  <label
                    key={char.name}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      char.selected
                        ? 'border-primary/25 bg-primary/[0.03]'
                        : 'border-border/20 bg-card/10 opacity-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={char.selected}
                      onChange={() => {
                        const updated = [...castParsed]
                        updated[i] = { ...char, selected: !char.selected }
                        setCastParsed(updated)
                      }}
                      className="mt-0.5 accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{char.name}</span>
                      <p className="text-xs text-muted-foreground mt-0.5 font-prose">
                        {char.description}
                      </p>
                    </div>
                  </label>
                ))}
                <div className="flex justify-between items-center pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setShowCastPreview(false)
                      setCastParsed([])
                      castGen.clear()
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs gap-1"
                    onClick={handleAcceptCast}
                    disabled={!castParsed.some(c => c.selected) || saving}
                  >
                    {saving ? (
                      <>Adding {castParsed.filter(c => c.selected).length}...</>
                    ) : (
                      <><Plus className="size-3" /> Add {castParsed.filter(c => c.selected).length} Characters</>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {!showCastPreview && !castGen.isStreaming && (
              <button
                onClick={() => setPhase(characters.length > 0 ? 'manual' : 'choose')}
                className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors"
              >
                {characters.length > 0 ? 'Add manually instead' : 'Back to options'}
              </button>
            )}
          </div>
        )}

        {/* Phase: Manual add */}
        {phase === 'manual' && editingIndex === null && (
          <div className="space-y-3 animate-wizard-reveal">
            <div className="p-4 rounded-xl border border-border/30 bg-card/20 space-y-3">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Character Name
                </label>
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="bg-transparent text-sm h-9 border-border/40"
                  placeholder="e.g. Kirle"
                  disabled={isBusy}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newName.trim()) {
                      e.preventDefault()
                      handleAddManual()
                    }
                  }}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Brief Description
                </label>
                <Textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className="min-h-[60px] text-sm bg-transparent font-prose resize-none border-border/40"
                  placeholder="A 12-year-old street urchin with a talent for picking locks..."
                  disabled={isBusy}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={handleAddManual}
                  disabled={!newName.trim() || isBusy}
                >
                  <Plus className="size-3" /> Add Character
                </Button>
              </div>
            </div>

            <button
              onClick={() => setPhase('cast')}
              className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors"
            >
              Or generate a cast instead
            </button>
          </div>
        )}
      </div>

      <StepNav
        onBack={onBack}
        onContinue={onContinue}
        canContinue={!isBusy && editingIndex === null && !showCastPreview}
      />
    </WizardShell>
  )
}

// ── PreferencesStep ─────────────────────────────────────

function PreferencesStep({
  storyId,
  onContinue,
  onBack,
  onSkip,
}: {
  storyId: string
  onContinue: () => void
  onBack: () => void
  onSkip: () => void
}) {
  const queryClient = useQueryClient()
  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })

  const updateMutation = useMutation({
    mutationFn: (data: { autoApplyLibrarianSuggestions?: boolean; contextOrderMode?: 'simple' | 'advanced' }) =>
      api.settings.update(storyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
    },
  })

  const autoApply = story?.settings.autoApplyLibrarianSuggestions ?? false
  const contextMode = story?.settings.contextOrderMode ?? 'simple'

  return (
    <WizardShell step="preferences" onSkip={onSkip}>
      <div className="space-y-8">

        {/* ── Librarian ── */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="size-4 text-primary/50" />
              <h3 className="text-sm font-medium text-foreground/80">The Librarian</h3>
            </div>
            <p className="font-prose text-xs text-muted-foreground leading-relaxed">
              After each generation, a background AI reads what was written and tracks
              characters, locations, plot points, and contradictions &mdash; building
              a living reference for your world.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => updateMutation.mutate({ autoApplyLibrarianSuggestions: false })}
              disabled={updateMutation.isPending}
              className={`group text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                !autoApply
                  ? 'border-primary/30 bg-primary/[0.04]'
                  : 'border-border/30 bg-card/10 hover:border-border/50'
              }`}
            >
              <Eye className="size-4 text-muted-foreground mb-2.5" />
              <div className="font-display text-[13px] italic leading-snug">Review first</div>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                The Librarian flags suggestions for you to accept or dismiss. Nothing changes without your say.
              </p>
            </button>
            <button
              onClick={() => updateMutation.mutate({ autoApplyLibrarianSuggestions: true })}
              disabled={updateMutation.isPending}
              className={`group text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                autoApply
                  ? 'border-primary/30 bg-primary/[0.04]'
                  : 'border-border/30 bg-card/10 hover:border-border/50'
              }`}
            >
              <Zap className="size-4 text-muted-foreground mb-2.5" />
              <div className="font-display text-[13px] italic leading-snug">Auto-accept</div>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                New knowledge is created and updated automatically. Your world-bible stays current as you write.
              </p>
            </button>
          </div>
        </div>

        {/* ── Context management ── */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Layers className="size-4 text-primary/50" />
              <h3 className="text-sm font-medium text-foreground/80">Context management</h3>
            </div>
            <p className="font-prose text-xs text-muted-foreground leading-relaxed">
              Controls how your fragments, prose, and instructions are assembled
              into the prompt that the AI sees when generating.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => updateMutation.mutate({ contextOrderMode: 'simple' })}
              disabled={updateMutation.isPending}
              className={`group text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                contextMode === 'simple'
                  ? 'border-primary/30 bg-primary/[0.04]'
                  : 'border-border/30 bg-card/10 hover:border-border/50'
              }`}
            >
              <div className="font-display text-[13px] italic leading-snug">Simple</div>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                Errata assembles the prompt for you &mdash; guidelines, world, characters, then prose.
                The right choice for most writers.
              </p>
            </button>
            <button
              onClick={() => updateMutation.mutate({ contextOrderMode: 'advanced' })}
              disabled={updateMutation.isPending}
              className={`group text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                contextMode === 'advanced'
                  ? 'border-primary/30 bg-primary/[0.04]'
                  : 'border-border/30 bg-card/10 hover:border-border/50'
              }`}
            >
              <div className="font-display text-[13px] italic leading-snug">Advanced</div>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                Unlocks the Block Editor &mdash; reorder, override, or inject custom
                blocks into the AI prompt directly.
              </p>
            </button>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed font-prose">
          Both settings can be changed anytime in Settings.
        </p>
      </div>

      <StepNav
        onBack={onBack}
        onContinue={onContinue}
      />
    </WizardShell>
  )
}

// ── CompleteStep ────────────────────────────────────────

function CompleteStep({
  guidelineId,
  worldId,
  characters,
  proseId,
  onComplete,
  onBack,
  onSkip,
}: {
  guidelineId: string | null
  worldId: string | null
  characters: CharData[]
  proseId: string | null
  onComplete: () => void
  onBack: () => void
  onSkip: () => void
}) {
  const savedCharacters = characters.filter(c => c.fragmentId)
  const items = [
    guidelineId && { label: 'Writing Guideline', type: 'guideline' },
    worldId && { label: 'World Setting', type: 'knowledge' },
    ...savedCharacters.map(c => ({ label: c.name, type: 'character' })),
    proseId && { label: 'Opening Prose', type: 'prose' },
  ].filter(Boolean) as { label: string; type: string }[]

  return (
    <WizardShell step="complete" onSkip={onSkip}>
      <div className="space-y-6">
        {items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 p-3 rounded-xl border border-border/30 bg-card/20"
              >
                <Check className="size-4 text-primary/50 shrink-0" />
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-[10px] text-muted-foreground ml-auto uppercase tracking-wider">
                  {item.type}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground font-prose italic">
            No fragments created yet &mdash; you can always add them later from the sidebar.
          </p>
        )}

      </div>

      <StepNav
        onBack={onBack}
        onContinue={onComplete}
        continueLabel="Start Writing"
      />
    </WizardShell>
  )
}

// ── Main Wizard ────────────────────────────────────────

export function StoryWizard({ storyId, onComplete }: StoryWizardProps) {
  const [step, setStep] = useState<WizardStep>('concept')
  const [initialized, setInitialized] = useState(false)

  // Content state
  const [storyName, setStoryName] = useState('')
  const [storyDesc, setStoryDesc] = useState('')
  const [guidelineContent, setGuidelineContent] = useState('')
  const [guidelineId, setGuidelineId] = useState<string | null>(null)
  const [worldContent, setWorldContent] = useState('')
  const [worldId, setWorldId] = useState<string | null>(null)
  const [characters, setCharacters] = useState<CharData[]>([])
  const [proseContent, setProseContent] = useState('')
  const [proseId, setProseId] = useState<string | null>(null)

  // Pre-populate from existing story
  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })

  const { data: existingFragments } = useQuery({
    queryKey: ['wizard-fragments', storyId],
    queryFn: () => api.fragments.list(storyId),
  })

  useEffect(() => {
    if (story) {
      if (!storyName) setStoryName(story.name === 'New Story' ? '' : story.name)
      if (!storyDesc) setStoryDesc(story.description)
    }
  }, [story]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (existingFragments && !initialized) {
      setInitialized(true)

      const gl = existingFragments.find(f => f.type === 'guideline')
      if (gl) {
        setGuidelineContent(gl.content)
        setGuidelineId(gl.id)
      }

      const world = existingFragments.find(f => f.type === 'knowledge' && f.sticky)
      if (world) {
        setWorldContent(world.content)
        setWorldId(world.id)
      }

      const chars = existingFragments.filter(f => f.type === 'character')
      if (chars.length > 0) {
        setCharacters(chars.map(c => ({
          name: c.name,
          description: c.description || '',
          content: c.content,
          fragmentId: c.id,
        })))
      }

      const prose = existingFragments.find(f => f.type === 'prose')
      if (prose) {
        setProseContent(prose.content)
        setProseId(prose.id)
      }
    }
  }, [existingFragments, initialized])

  const goTo = (s: WizardStep) => setStep(s)

  switch (step) {
    case 'concept':
      return (
        <ConceptStep
          storyId={storyId}
          storyName={storyName}
          setStoryName={setStoryName}
          storyDesc={storyDesc}
          setStoryDesc={setStoryDesc}
          onContinue={() => goTo('guideline')}
          onSkip={onComplete}
        />
      )

    case 'guideline':
      return (
        <ContentStep
          key="guideline"
          storyId={storyId}
          step="guideline"
          content={guidelineContent}
          setContent={setGuidelineContent}
          fragmentId={guidelineId}
          onSaved={id => setGuidelineId(id)}
          onContinue={() => goTo('world')}
          onBack={() => goTo('concept')}
          onSkip={onComplete}
          storyDesc={storyDesc}
        />
      )

    case 'world':
      return (
        <ContentStep
          key="world"
          storyId={storyId}
          step="world"
          content={worldContent}
          setContent={setWorldContent}
          fragmentId={worldId}
          onSaved={id => setWorldId(id)}
          onContinue={() => goTo('characters')}
          onBack={() => goTo('guideline')}
          onSkip={onComplete}
          storyDesc={storyDesc}
        />
      )

    case 'characters':
      return (
        <CharactersStep
          storyId={storyId}
          characters={characters}
          setCharacters={setCharacters}
          onContinue={() => goTo('preferences')}
          onBack={() => goTo('world')}
          onSkip={onComplete}
          storyDesc={storyDesc}
        />
      )

    case 'preferences':
      return (
        <PreferencesStep
          storyId={storyId}
          onContinue={() => goTo('prose')}
          onBack={() => goTo('characters')}
          onSkip={onComplete}
        />
      )

    case 'prose':
      return (
        <ContentStep
          key="prose"
          storyId={storyId}
          step="prose"
          content={proseContent}
          setContent={setProseContent}
          fragmentId={proseId}
          onSaved={id => setProseId(id)}
          onContinue={() => goTo('complete')}
          onBack={() => goTo('characters')}
          onSkip={onComplete}
          storyDesc={storyDesc}
        />
      )

    case 'complete':
      return (
        <CompleteStep
          guidelineId={guidelineId}
          worldId={worldId}
          characters={characters}
          proseId={proseId}
          onComplete={onComplete}
          onBack={() => goTo('prose')}
          onSkip={onComplete}
        />
      )
  }
}
