import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Sparkles, RefreshCw, Square, ChevronLeft, ChevronRight,
  Plus, Trash2, Check, Pen, Bot, Users,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────

interface StoryWizardProps {
  storyId: string
  onComplete: () => void
}

type WizardStep = 'concept' | 'guideline' | 'world' | 'characters' | 'prose' | 'complete'

const STEPS: WizardStep[] = ['concept', 'guideline', 'world', 'characters', 'prose', 'complete']

const STEP_META: Record<WizardStep, { numeral: string; title: string; description: string }> = {
  concept:    { numeral: '',    title: 'Your Story',          description: 'What is this story about?' },
  guideline:  { numeral: 'I',   title: 'Writing Guideline',   description: 'Define the tone, voice, and style of your prose.' },
  world:      { numeral: 'II',  title: 'World Setting',       description: 'Paint the world your characters inhabit.' },
  characters: { numeral: 'III', title: 'Characters',          description: 'Bring the people of your story to life.' },
  prose:      { numeral: 'IV',  title: 'Opening Prose',       description: 'Write the first words of your story.' },
  complete:   { numeral: 'V',   title: 'Ready',               description: 'Your story is set up and ready to write.' },
}

interface CharData {
  concept: string
  content: string
  fragmentId: string | null
}

// ── useGenerate hook ───────────────────────────────────

function useGenerate(storyId: string) {
  const [text, setText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null)

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
        accumulated += value
        setText(accumulated)
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

// ── StepShell ──────────────────────────────────────────

function StepShell({
  step,
  onSkip,
  children,
}: {
  step: WizardStep
  onSkip: () => void
  children: React.ReactNode
}) {
  const meta = STEP_META[step]
  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl italic">Story Setup</h2>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground/50"
            onClick={onSkip}
          >
            Skip wizard
          </Button>
        </div>
        {/* Progress dots — concept excluded from numbered progress */}
        <div className="flex items-center gap-3">
          {STEPS.filter(s => s !== 'concept' && s !== 'complete').map((s, i) => {
            const si = STEPS.indexOf(s)
            const isCurrent = si === stepIndex
            const isCompleted = si < stepIndex
            const numeral = STEP_META[s].numeral
            return (
              <div key={s} className="flex items-center gap-3">
                {i > 0 && (
                  <div className={`h-px w-6 transition-colors ${isCompleted ? 'bg-primary/40' : 'bg-border/40'}`} />
                )}
                <span className={`text-xs font-display italic transition-colors ${
                  isCurrent ? 'text-primary font-medium' :
                  isCompleted ? 'text-primary/40' :
                  'text-muted-foreground/25'
                }`}>
                  {numeral}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto" key={step}>
        <div className="animate-wizard-step-enter max-w-2xl mx-auto px-6 py-8">
          {/* Step watermark + heading */}
          <div className="relative mb-8">
            {meta.numeral && (
              <span className="absolute -top-4 -left-2 font-display text-6xl italic text-muted-foreground/[0.07] select-none pointer-events-none">
                {meta.numeral}
              </span>
            )}
            <h3 className="font-display text-2xl italic">{meta.title}</h3>
            <p className="font-prose text-sm text-muted-foreground/60 mt-1">{meta.description}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── AI Bar ─────────────────────────────────────────────

function AIBar({
  hasContent,
  isStreaming,
  placeholder,
  onGenerate,
  onStop,
}: {
  hasContent: boolean
  isStreaming: boolean
  placeholder: string
  onGenerate: (instruction: string) => void
  onStop: () => void
}) {
  const [instruction, setInstruction] = useState('')

  const handleSubmit = () => {
    onGenerate(instruction)
    setInstruction('')
  }

  return (
    <div className="flex items-center gap-2 mt-3 p-2 rounded-lg border border-border/50 bg-card/50">
      <Input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={placeholder}
        className="flex-1 h-8 text-sm bg-transparent border-0 shadow-none focus-visible:ring-0"
        disabled={isStreaming}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            if (!isStreaming) handleSubmit()
          }
        }}
      />
      {isStreaming ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5 shrink-0"
          onClick={onStop}
        >
          <Square className="size-3" />
          Stop
        </Button>
      ) : (
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5 shrink-0"
          onClick={handleSubmit}
        >
          {hasContent ? (
            <><RefreshCw className="size-3" />Refine</>
          ) : (
            <><Sparkles className="size-3" />Generate</>
          )}
        </Button>
      )}
      <span className="text-[10px] text-muted-foreground/30 shrink-0 hidden sm:inline">
        Ctrl+Enter
      </span>
    </div>
  )
}

// ── ContentTextarea ────────────────────────────────────

function ContentTextarea({
  value,
  onChange,
  isStreaming,
  placeholder,
  charLimit,
  fontClass = 'font-prose',
}: {
  value: string
  onChange: (v: string) => void
  isStreaming: boolean
  placeholder: string
  charLimit?: { min: number; max: number }
  fontClass?: string
}) {
  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`min-h-[200px] text-sm bg-transparent resize-none ${fontClass}`}
        disabled={isStreaming}
      />
      {isStreaming && (
        <span className="absolute bottom-3 right-3 inline-block w-0.5 h-4 bg-amber-500 animate-wizard-cursor" />
      )}
      {charLimit && (
        <div className={`text-[10px] mt-1 text-right ${
          value.length < charLimit.min ? 'text-muted-foreground/40' :
          value.length > charLimit.max ? 'text-destructive' :
          'text-muted-foreground/40'
        }`}>
          {value.length} / {charLimit.min}-{charLimit.max}
        </div>
      )}
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

  // Provider selection
  const { data: globalConfig } = useQuery({
    queryKey: ['global-config'],
    queryFn: () => api.config.getProviders(),
  })
  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })
  const providerMutation = useMutation({
    mutationFn: (data: { providerId?: string | null; modelId?: string | null }) =>
      api.settings.update(storyId, data),
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
    <StepShell step="concept" onSkip={onSkip}>
      <div className="space-y-5">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
            Story Name
          </label>
          <Input
            value={storyName}
            onChange={(e) => setStoryName(e.target.value)}
            className="bg-transparent font-display text-lg"
            placeholder="Untitled Story"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
            What is this story about?
          </label>
          <Textarea
            value={storyDesc}
            onChange={(e) => setStoryDesc(e.target.value)}
            className="min-h-[120px] text-sm bg-transparent font-prose resize-none"
            placeholder="A brief description or theme — this guides AI generation in later steps..."
          />
        </div>

        {/* Provider selector — only when multiple providers */}
        {showProviderPicker && globalConfig && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
              AI Provider
            </label>
            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border/50 bg-card/30">
              <Bot className="size-4 text-muted-foreground/40 shrink-0" />
              <select
                value={story?.settings.providerId ?? ''}
                onChange={(e) => {
                  const providerId = e.target.value || null
                  providerMutation.mutate({ providerId, modelId: null })
                }}
                disabled={providerMutation.isPending}
                className="flex-1 text-sm bg-transparent border-none outline-none cursor-pointer appearance-none pr-4"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center' }}
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
            <p className="text-[10px] text-muted-foreground/40 mt-1">
              Used for AI generation throughout the wizard
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end mt-8 pt-4 border-t border-border/30">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={handleContinue}
          disabled={saving}
        >
          Continue
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </StepShell>
  )
}

// ── ContentStep (guideline / world / prose) ────────────

function ContentStep({
  storyId,
  step,
  content,
  setContent,
  fragmentId,
  onContinue,
  onBack,
  onSkip,
  storyDesc,
}: {
  storyId: string
  step: 'guideline' | 'world' | 'prose'
  content: string
  setContent: (v: string) => void
  fragmentId: string | null
  onContinue: (savedId: string | null) => void
  onBack: () => void
  onSkip: () => void
  storyDesc: string
}) {
  const queryClient = useQueryClient()
  const gen = useGenerate(storyId)
  const [saving, setSaving] = useState(false)

  // Sync streaming text into content
  useEffect(() => {
    if (gen.text) setContent(gen.text)
  }, [gen.text, setContent])

  const buildPrompt = (instruction: string) => {
    const hasExistingContent = content.trim().length > 0 && !gen.isStreaming

    if (hasExistingContent && instruction.trim()) {
      // Refinement
      return `[WIZARD SETUP — NOT a prose request]\nRefine the following ${step} based on the feedback below. Maintain format and purpose but incorporate the requested changes. Output ONLY the refined text.\n\nCurrent text:\n---\n${content}\n---\n\nRequested changes: ${instruction}`
    }

    const storyContext = storyDesc ? `\nStory concept: ${storyDesc}` : ''

    if (step === 'guideline') {
      return `[WIZARD SETUP — NOT a prose request]\nGenerate a concise writing guideline for this story. Define: narrative tone, prose style, point of view, pacing approach, and any literary techniques to use. Output between 500-2000 characters. Output ONLY the guideline text.${storyContext}${instruction ? `\n${instruction}` : ''}`
    }
    if (step === 'world') {
      return `[WIZARD SETUP — NOT a prose request]\nGenerate a world setting description for this story. Cover: setting, time period, geography, culture, rules/magic systems, atmosphere. Be evocative but concise. Output ONLY the setting text.${storyContext}${instruction ? `\n${instruction}` : ''}`
    }
    // prose
    return `Write an opening scene for this story. Use the established writing guidelines, incorporate the world and characters. Create an engaging, immersive opening that hooks the reader.${storyContext}${instruction ? `\n${instruction}` : ''}`
  }

  const handleGenerate = (instruction: string) => {
    gen.generate(buildPrompt(instruction))
  }

  const handleContinue = async () => {
    if (!content.trim()) {
      onContinue(fragmentId)
      return
    }

    setSaving(true)
    try {
      const typeMap = { guideline: 'guideline', world: 'knowledge', prose: 'prose' } as const
      const fragType = typeMap[step]
      const nameMap = { guideline: 'Writing Guideline', world: 'World Setting', prose: 'Opening' } as const
      const descMap = { guideline: 'Core writing style and tone', world: 'World and setting details', prose: 'Story opening' } as const

      let savedId = fragmentId
      if (savedId) {
        await api.fragments.update(storyId, savedId, {
          name: nameMap[step],
          description: descMap[step],
          content: content.trim(),
        })
      } else {
        const created = await api.fragments.create(storyId, {
          type: fragType,
          name: nameMap[step],
          description: descMap[step],
          content: content.trim(),
        })
        savedId = created.id

        // Pin and set placement
        if (step === 'guideline') {
          await api.fragments.toggleSticky(storyId, savedId, true)
          await api.fragments.setPlacement(storyId, savedId, 'system')
        } else if (step === 'world') {
          await api.fragments.toggleSticky(storyId, savedId, true)
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      setSaving(false)
      onContinue(savedId)
    } catch {
      setSaving(false)
      onContinue(fragmentId)
    }
  }

  const placeholderMap = {
    guideline: 'Write in a dark, lyrical tone with close third-person POV...',
    world: 'A vast kingdom nestled between mountain ranges...',
    prose: 'The rain fell in sheets against the windowpane...',
  }

  const aiBarPlaceholder = {
    guideline: 'Describe the tone you want...',
    world: 'Describe the world or setting...',
    prose: 'Describe how the story should open...',
  }

  return (
    <StepShell step={step} onSkip={onSkip}>
      <div className="space-y-1">
        <ContentTextarea
          value={content}
          onChange={setContent}
          isStreaming={gen.isStreaming}
          placeholder={placeholderMap[step]}
          charLimit={step === 'guideline' ? { min: 500, max: 2000 } : undefined}
          fontClass={step === 'prose' ? 'prose-content' : 'font-prose'}
        />
        <AIBar
          hasContent={content.trim().length > 0}
          isStreaming={gen.isStreaming}
          placeholder={aiBarPlaceholder[step]}
          onGenerate={handleGenerate}
          onStop={gen.stop}
        />
        {gen.error && (
          <p className="text-xs text-destructive mt-2">{gen.error}</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-8 pt-4 border-t border-border/30">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={onBack}
        >
          <ChevronLeft className="size-3.5" />
          Back
        </Button>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={handleContinue}
          disabled={saving || gen.isStreaming}
        >
          {saving ? 'Saving...' : 'Continue'}
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </StepShell>
  )
}

// ── CharactersStep ─────────────────────────────────────

function parseCastList(text: string): Array<{ name: string; concept: string }> {
  const results: Array<{ name: string; concept: string }> = []
  // Match lines like "1. Name — description" or "Name: description" or "- Name, description"
  const lines = text.split('\n').filter(l => l.trim())
  for (const line of lines) {
    const cleaned = line.replace(/^\s*[-*\d.)\]]+\s*/, '').trim()
    if (!cleaned) continue
    // Try "Name — description" or "Name - description" or "Name: description"
    const separatorMatch = cleaned.match(/^(.+?)\s*[—–:\-]\s+(.+)$/)
    if (separatorMatch) {
      const name = separatorMatch[1].replace(/\*\*/g, '').trim()
      const desc = separatorMatch[2].replace(/\*\*/g, '').trim()
      if (name && name.length < 60) {
        results.push({ name, concept: `${name}, ${desc}` })
      }
    }
  }
  return results
}

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
  const gen = useGenerate(storyId)
  const castGen = useGenerate(storyId)
  const [concept, setConcept] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)
  const [castInstruction, setCastInstruction] = useState('')
  const [showCastPreview, setShowCastPreview] = useState(false)
  const [castParsed, setCastParsed] = useState<Array<{ name: string; concept: string; selected: boolean }>>([])

  // When streaming, update the editing character's content
  useEffect(() => {
    if (gen.text && editingIndex !== null) {
      setEditContent(gen.text)
    }
  }, [gen.text, editingIndex])

  // When cast generation completes, parse the results
  useEffect(() => {
    if (castGen.text && !castGen.isStreaming) {
      const parsed = parseCastList(castGen.text)
      if (parsed.length > 0) {
        setCastParsed(parsed.map(p => ({ ...p, selected: true })))
        setShowCastPreview(true)
      }
    }
  }, [castGen.text, castGen.isStreaming])

  const handleGenerate = (instruction: string) => {
    const target = editingIndex !== null ? characters[editingIndex]?.concept : concept
    if (!target && !instruction) return

    const storyContext = storyDesc ? `\nStory concept: ${storyDesc}` : ''

    if (editingIndex !== null && editContent.trim()) {
      gen.generate(`[WIZARD SETUP — NOT a prose request]\nRefine the following character description based on the feedback below. Maintain format and purpose but incorporate the requested changes. Output ONLY the character description.\n\nCurrent text:\n---\n${editContent}\n---\n\nRequested changes: ${instruction}`)
    } else {
      gen.generate(`[WIZARD SETUP — NOT a prose request]\nGenerate a character description for: ${target}\nInclude: personality, appearance, motivations, relationships, key traits. Be vivid but concise. Output ONLY the character description.${storyContext}${instruction ? `\n${instruction}` : ''}`)
    }
  }

  const handleGenerateCast = () => {
    const storyContext = storyDesc ? `\nStory concept: ${storyDesc}` : ''
    const existingChars = characters.length > 0
      ? `\nExisting characters: ${characters.map(c => c.concept.split(',')[0].trim()).join(', ')}`
      : ''
    castGen.generate(`[WIZARD SETUP — NOT a prose request]\nGenerate a cast of characters for this story. For each character, provide their name and a brief concept (role, key trait, relationship to others).\n\nFormat each character on its own line as:\nName — brief concept/role\n\nGenerate 3-6 characters that would create interesting dynamics together. Output ONLY the character list, no extra text.${storyContext}${existingChars}${castInstruction ? `\n${castInstruction}` : ''}`)
    setCastInstruction('')
  }

  const handleAcceptCast = () => {
    const selected = castParsed.filter(c => c.selected)
    const newChars: CharData[] = selected.map(c => ({
      concept: c.concept,
      content: '',
      fragmentId: null,
    }))
    setCharacters([...characters, ...newChars])
    setShowCastPreview(false)
    setCastParsed([])
    castGen.clear()
  }

  const handleAddCharacter = () => {
    if (!concept.trim()) return
    const newChar: CharData = { concept: concept.trim(), content: '', fragmentId: null }
    setCharacters([...characters, newChar])
    setEditingIndex(characters.length)
    setEditContent('')
    setEditName(concept.split(',')[0].trim())
    gen.clear()
    const storyContext = storyDesc ? `\nStory concept: ${storyDesc}` : ''
    gen.generate(`[WIZARD SETUP — NOT a prose request]\nGenerate a character description for: ${concept.trim()}\nInclude: personality, appearance, motivations, relationships, key traits. Be vivid but concise. Output ONLY the character description.${storyContext}`)
    setConcept('')
  }

  const handleSaveCharacter = async () => {
    if (editingIndex === null || !editContent.trim()) return
    setSaving(true)

    const char = characters[editingIndex]
    const charName = editName.trim() || char.concept.split(',')[0].trim() || char.concept

    try {
      let savedId = char.fragmentId
      if (savedId) {
        await api.fragments.update(storyId, savedId, {
          name: charName,
          description: charName.slice(0, 50),
          content: editContent.trim(),
        })
      } else {
        const created = await api.fragments.create(storyId, {
          type: 'character',
          name: charName,
          description: charName.slice(0, 50),
          content: editContent.trim(),
        })
        savedId = created.id
        await api.fragments.toggleSticky(storyId, savedId, true)
      }

      const updated = [...characters]
      updated[editingIndex] = {
        ...char,
        concept: editName.trim() ? `${editName.trim()}, ${char.concept.split(',').slice(1).join(',').trim() || charName}` : char.concept,
        content: editContent.trim(),
        fragmentId: savedId,
      }
      setCharacters(updated)
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    } catch {
      // best-effort
    }

    setSaving(false)
    setEditingIndex(null)
    setEditContent('')
    setEditName('')
    gen.clear()
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
      setEditContent('')
      setEditName('')
      gen.clear()
    }
  }

  const handleEditCharacter = (index: number) => {
    gen.clear()
    setEditingIndex(index)
    setEditContent(characters[index].content)
    setEditName(characters[index].concept.split(',')[0].trim())
  }

  const isEditing = editingIndex !== null
  const isBusy = gen.isStreaming || castGen.isStreaming

  return (
    <StepShell step="characters" onSkip={onSkip}>
      <div className="space-y-4">
        {/* Character list */}
        {characters.length > 0 && (
          <div className="space-y-2">
            {characters.map((char, i) => (
              <div
                key={i}
                className={`group flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                  editingIndex === i
                    ? 'border-primary/30 bg-primary/[0.03]'
                    : 'border-border/40 bg-card/30 hover:border-border/60'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{char.concept.split(',')[0].trim()}</span>
                    {char.fragmentId && (
                      <Check className="size-3 text-primary/60 shrink-0" />
                    )}
                  </div>
                  {char.content && (
                    <p className="text-xs text-muted-foreground/50 mt-0.5 line-clamp-1 font-prose">
                      {char.content}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => handleEditCharacter(i)}
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
            ))}
          </div>
        )}

        {/* Editor for selected character */}
        {isEditing && (
          <div className="space-y-2 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                Name
              </label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-transparent text-sm font-medium"
                placeholder="Character name"
                disabled={gen.isStreaming}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                Description
              </label>
              <ContentTextarea
                value={editContent}
                onChange={setEditContent}
                isStreaming={gen.isStreaming}
                placeholder="Character description..."
                fontClass="font-prose"
              />
            </div>
            <AIBar
              hasContent={editContent.trim().length > 0}
              isStreaming={gen.isStreaming}
              placeholder="Describe this character or refine..."
              onGenerate={handleGenerate}
              onStop={gen.stop}
            />
            {gen.error && (
              <p className="text-xs text-destructive mt-1">{gen.error}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => { setEditingIndex(null); setEditContent(''); setEditName(''); gen.clear() }}
                disabled={gen.isStreaming}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-xs gap-1"
                onClick={handleSaveCharacter}
                disabled={!editContent.trim() || saving || gen.isStreaming}
              >
                {saving ? 'Saving...' : <><Check className="size-3" />Save Character</>}
              </Button>
            </div>
          </div>
        )}

        {/* Cast preview after bulk generation */}
        {showCastPreview && castParsed.length > 0 && (
          <div className="space-y-2 pt-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Generated cast — select characters to add
            </label>
            {castParsed.map((char, i) => (
              <label
                key={i}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  char.selected ? 'border-primary/30 bg-primary/[0.03]' : 'border-border/30 bg-card/20 opacity-50'
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
                  <p className="text-xs text-muted-foreground/50 mt-0.5">{char.concept}</p>
                </div>
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => { setShowCastPreview(false); setCastParsed([]); castGen.clear() }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-xs gap-1"
                onClick={handleAcceptCast}
                disabled={!castParsed.some(c => c.selected)}
              >
                <Plus className="size-3" />
                Add {castParsed.filter(c => c.selected).length} Characters
              </Button>
            </div>
          </div>
        )}

        {/* Add new character / generate cast */}
        {!isEditing && !showCastPreview && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                className="flex-1 bg-transparent text-sm"
                placeholder="Character concept, e.g. 'Kirle, a 12 year old furry dog'"
                disabled={isBusy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && concept.trim()) {
                    e.preventDefault()
                    handleAddCharacter()
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={handleAddCharacter}
                disabled={!concept.trim() || isBusy}
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>

            {/* Bulk generate cast */}
            <div className="flex items-center gap-2 p-2 rounded-lg border border-dashed border-border/50 bg-card/20">
              <Input
                value={castInstruction}
                onChange={(e) => setCastInstruction(e.target.value)}
                placeholder="Or describe the cast you need..."
                className="flex-1 h-8 text-sm bg-transparent border-0 shadow-none focus-visible:ring-0"
                disabled={castGen.isStreaming}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !castGen.isStreaming) {
                    e.preventDefault()
                    handleGenerateCast()
                  }
                }}
              />
              {castGen.isStreaming ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5 shrink-0"
                  onClick={castGen.stop}
                >
                  <Square className="size-3" />
                  Stop
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5 shrink-0"
                  onClick={handleGenerateCast}
                  disabled={isBusy}
                >
                  <Users className="size-3" />
                  Generate Cast
                </Button>
              )}
            </div>
            {castGen.error && (
              <p className="text-xs text-destructive">{castGen.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-8 pt-4 border-t border-border/30">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={onBack}
        >
          <ChevronLeft className="size-3.5" />
          Back
        </Button>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={onContinue}
          disabled={isBusy || isEditing || showCastPreview}
        >
          Continue
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </StepShell>
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
    ...savedCharacters.map(c => ({ label: c.concept.split(',')[0].trim(), type: 'character' })),
    proseId && { label: 'Opening Prose', type: 'prose' },
  ].filter(Boolean) as { label: string; type: string }[]

  return (
    <StepShell step="complete" onSkip={onSkip}>
      <div className="space-y-6">
        {items.length > 0 ? (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Created fragments
            </label>
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-card/30">
                <Check className="size-4 text-primary/60 shrink-0" />
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-[10px] text-muted-foreground/40 ml-auto uppercase tracking-wider">{item.type}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/50 font-prose italic">
            No fragments created yet — you can always add them later.
          </p>
        )}

        <div className="flex justify-center pt-4">
          <Button
            size="lg"
            className="gap-2 font-display text-base italic px-8"
            onClick={onComplete}
          >
            Start Writing
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-start mt-8 pt-4 border-t border-border/30">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={onBack}
        >
          <ChevronLeft className="size-3.5" />
          Back
        </Button>
      </div>
    </StepShell>
  )
}

// ── Main Wizard ────────────────────────────────────────

export function StoryWizard({ storyId, onComplete }: StoryWizardProps) {
  const [step, setStep] = useState<WizardStep>('concept')

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

  useEffect(() => {
    if (story) {
      if (!storyName) setStoryName(story.name === 'New Story' ? '' : story.name)
      if (!storyDesc) setStoryDesc(story.description)
    }
  }, [story]) // eslint-disable-line react-hooks/exhaustive-deps

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
          onContinue={(id) => { setGuidelineId(id); goTo('world') }}
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
          onContinue={(id) => { setWorldId(id); goTo('characters') }}
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
          onContinue={() => goTo('prose')}
          onBack={() => goTo('world')}
          onSkip={onComplete}
          storyDesc={storyDesc}
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
          onContinue={(id) => { setProseId(id); goTo('complete') }}
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
