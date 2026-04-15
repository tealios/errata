import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { X, Bot, Plus } from 'lucide-react'
import { Caption, EmptyHint } from '@/components/ui/prose-text'
import { Wizard } from '@/components/ui/wizard'

// ── Types ──────────────────────────────────────────────

interface StoryWizardProps {
  storyId: string
  onComplete: () => void
}

type WizardStep = 'concept' | 'guideline' | 'world' | 'characters' | 'preferences' | 'prose' | 'complete'

const STEP_QUESTIONS: Record<WizardStep, { question: string; subtitle: string }> = {
  concept:     { question: 'Begin your story',           subtitle: 'A name, and a spark of what it is about.' },
  guideline:   { question: 'How should it be written?',  subtitle: 'A few sentences on voice, tone, and style.' },
  world:       { question: 'Where does it take place?',  subtitle: 'Setting, era, anything essential.' },
  characters:  { question: 'Who inhabits it?',           subtitle: 'One or two to start. You can always add more later.' },
  preferences: { question: 'How should Errata help?',    subtitle: 'You can change your mind anytime in Settings.' },
  prose:       { question: 'How does it begin?',         subtitle: 'Write an opening, or ask Errata to draft one.' },
  complete:    { question: 'Your story is ready.',       subtitle: 'Everything you wrote is a fragment you can edit from the sidebar.' },
}

interface CharData {
  name: string
  description: string
  fragmentId: string | null
}

/** How many steps count toward the Roman-numeral progress indicator. */
const COUNTED_STEPS: WizardStep[] = ['guideline', 'world', 'characters', 'preferences', 'prose']

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
    readerRef.current?.cancel()
    readerRef.current = null
    setIsStreaming(false)
  }, [])

  const clear = useCallback(() => {
    setText('')
    setError(null)
  }, [])

  return { text, setText, isStreaming, error, generate, stop, clear }
}

// ── Shared bits ───────────────────────────────────────

function StepShell({ step, children }: { step: WizardStep; children: React.ReactNode }) {
  const q = STEP_QUESTIONS[step]
  return (
    <Wizard.StepBody width="narrow">
      <Wizard.StepHeader>
        <Wizard.StepTitle>{q.question}</Wizard.StepTitle>
        <Wizard.StepDescription>{q.subtitle}</Wizard.StepDescription>
      </Wizard.StepHeader>
      {children}
    </Wizard.StepBody>
  )
}

/**
 * The single AI-assist affordance used across steps. Idle: a quiet italic
 * serif link. Streaming: a breathing dot + "drafting…" with an inline "stop".
 */
function AiAssistLink({
  isStreaming,
  onClick,
  onStop,
  label,
  streamingLabel = 'drafting',
  error,
}: {
  isStreaming: boolean
  onClick: () => void
  onStop: () => void
  label: string
  streamingLabel?: string
  error?: string | null
}) {
  if (error) {
    return (
      <p className="text-xs text-destructive/80 font-prose">
        Errata couldn’t reach your provider.{' '}
        <button onClick={onClick} className="underline hover:text-destructive">Try again</button>
        {' '}or skip and add this later.
      </p>
    )
  }
  if (isStreaming) {
    return (
      <div className="flex items-center gap-2 text-xs font-display italic text-muted-foreground">
        <span className="inline-block size-1 rounded-full bg-primary/60 animate-wisp-breathe" aria-hidden />
        <span>{streamingLabel}</span>
        <span className="text-muted-foreground/40">·</span>
        <button onClick={onStop} className="underline decoration-dotted underline-offset-2 hover:text-foreground">
          stop
        </button>
      </div>
    )
  }
  return (
    <button
      onClick={onClick}
      className="text-xs font-display italic text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
    </button>
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
    <Wizard.StepFooter>
      {showBack && onBack ? <Wizard.BackButton onBack={onBack} /> : <div />}
      <Wizard.NextButton onAdvance={onContinue} disabled={!canContinue}>
        {continueLabel}
      </Wizard.NextButton>
    </Wizard.StepFooter>
  )
}

// ── Cast-list parsing ─────────────────────────────────

function parseCastList(text: string): Array<{ name: string; description: string }> {
  const results: Array<{ name: string; description: string }> = []
  for (const raw of text.split('\n')) {
    const cleaned = raw.replace(/^\s*[-*\d.)\]]+\s*/, '').trim()
    if (!cleaned) continue
    const m = cleaned.match(/^(.+?)\s*[—–:\-]\s+(.+)$/)
    if (!m) continue
    const name = m[1].replace(/\*\*/g, '').trim()
    const desc = m[2].replace(/\*\*/g, '').trim()
    if (name && name.length < 60) results.push({ name, description: desc })
  }
  return results
}

// ── ConceptStep ───────────────────────────────────────

function ConceptStep({
  storyId,
  storyName,
  setStoryName,
  storyDesc,
  setStoryDesc,
  onContinue,
}: {
  storyId: string
  storyName: string
  setStoryName: (v: string) => void
  storyDesc: string
  setStoryDesc: (v: string) => void
  onContinue: () => void
}) {
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['story', storyId] }),
  })

  const enabledProviders = globalConfig?.providers.filter(p => p.enabled) ?? []
  const multipleProviders = enabledProviders.length > 1

  const activeProvider = (() => {
    const override = story?.settings.modelOverrides?.generation?.providerId
    if (override) return enabledProviders.find(p => p.id === override) ?? null
    if (globalConfig?.defaultProviderId) {
      return enabledProviders.find(p => p.id === globalConfig.defaultProviderId) ?? null
    }
    return null
  })()

  const handleContinue = async () => {
    setSaving(true)
    try {
      await api.stories.update(storyId, {
        name: storyName.trim() || 'Untitled Story',
        description: storyDesc.trim(),
      })
    } finally {
      setSaving(false)
      onContinue()
    }
  }

  return (
    <StepShell step="concept">
      <div className="space-y-8">
        <div className="space-y-5">
          <Input
            value={storyName}
            onChange={e => setStoryName(e.target.value)}
            autoFocus
            placeholder="Untitled Story"
            className="bg-transparent font-display text-2xl italic border border-border/40 rounded-lg shadow-none px-4 h-12 focus-visible:ring-0 focus-visible:border-foreground/50 placeholder:text-muted-foreground/40"
          />
          <Textarea
            value={storyDesc}
            onChange={e => setStoryDesc(e.target.value)}
            placeholder="A noir detective in a city where memories can be bought, sold, and forged…"
            className="min-h-[120px] bg-transparent font-prose text-base leading-relaxed resize-none border border-border/40 rounded-lg px-4 py-3 shadow-none focus-visible:ring-0 focus-visible:border-foreground/50 placeholder:text-muted-foreground/40"
          />
        </div>

        {multipleProviders && (
          <div className="text-xs font-display italic text-muted-foreground">
            Writing with{' '}
            <button
              onClick={() => setProviderOpen(o => !o)}
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              {activeProvider ? `${activeProvider.name} · ${activeProvider.defaultModel}` : 'default provider'}
            </button>
            {providerOpen && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-border/50 bg-card/30 px-2.5 py-1.5">
                <Bot className="size-3 text-muted-foreground/60" aria-hidden />
                <select
                  value={story?.settings.modelOverrides?.generation?.providerId ?? ''}
                  onChange={e => providerMutation.mutate({ providerId: e.target.value || null, modelId: null })}
                  disabled={providerMutation.isPending}
                  className="bg-transparent text-xs font-sans not-italic outline-none cursor-pointer appearance-none pr-4 text-foreground/80"
                >
                  <option value="">
                    {globalConfig?.defaultProviderId
                      ? `${enabledProviders.find(p => p.id === globalConfig.defaultProviderId)?.name ?? 'Default'} (default)`
                      : 'Default'}
                  </option>
                  {enabledProviders
                    .filter(p => p.id !== globalConfig?.defaultProviderId)
                    .map(p => (
                      <option key={p.id} value={p.id}>{p.name} · {p.defaultModel}</option>
                    ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      <StepNav onContinue={handleContinue} canContinue={!saving} showBack={false} />
    </StepShell>
  )
}

// ── ContentStep (guideline / world / prose) ───────────

const CONTENT_META = {
  guideline: {
    placeholder: 'Close third-person, lyrical and slow. Present tense. Let sentences breathe.',
    font: 'font-prose',
    fragmentType: 'guideline' as const,
    name: 'Writing Guideline',
    description: 'Core writing style and tone',
    minHeight: 'min-h-[180px]',
  },
  world: {
    placeholder: 'A drowned archipelago forty years after the flood. Salt rain. Boats for streets.',
    font: 'font-prose',
    fragmentType: 'knowledge' as const,
    name: 'World Setting',
    description: 'World and setting details',
    minHeight: 'min-h-[180px]',
  },
  prose: {
    placeholder: 'The rain fell in sheets against the window…',
    font: 'prose-content',
    fragmentType: 'prose' as const,
    name: 'Opening',
    description: 'Story opening',
    minHeight: 'min-h-[260px]',
  },
} as const

function buildPrompt(step: 'guideline' | 'world' | 'prose', storyDesc: string, existing: string) {
  const ctx = storyDesc ? `\nStory concept: ${storyDesc}` : ''
  if (existing.trim()) {
    return `[WIZARD SETUP — NOT a prose request]\nRefresh this ${step}. Keep its purpose but give it a different angle. Output ONLY the replacement text.${ctx}\n\nCurrent:\n---\n${existing}\n---`
  }
  if (step === 'guideline') {
    return `[WIZARD SETUP — NOT a prose request]\nWrite a concise writing guideline. Define narrative tone, prose style, POV, pacing, and any techniques. 500–2000 chars. Output ONLY the guideline text.${ctx}`
  }
  if (step === 'world') {
    return `[WIZARD SETUP — NOT a prose request]\nWrite an evocative but concise world setting: place, era, atmosphere, rules. Output ONLY the setting text.${ctx}`
  }
  return `Write an opening scene. Use the established guidelines and characters. Hook the reader.${ctx}`
}

function ContentStep({
  storyId,
  step,
  content,
  setContent,
  fragmentId,
  onContinue,
  onBack,
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
  onSaved: (id: string) => void
  storyDesc: string
}) {
  const queryClient = useQueryClient()
  const gen = useGenerate(storyId)
  const meta = CONTENT_META[step]
  const fragmentIdRef = useRef(fragmentId)
  const lastSavedRef = useRef(content.trim())
  const [saving, setSaving] = useState(false)

  useEffect(() => { fragmentIdRef.current = fragmentId }, [fragmentId])

  // Stream into the textarea directly — no separate preview surface.
  useEffect(() => {
    if (gen.isStreaming && gen.text) setContent(gen.text)
  }, [gen.text, gen.isStreaming, setContent])

  const save = useCallback(async (text: string): Promise<string | null> => {
    const trimmed = text.trim()
    if (!trimmed || trimmed === lastSavedRef.current) return fragmentIdRef.current
    setSaving(true)
    try {
      let savedId = fragmentIdRef.current
      if (savedId) {
        await api.fragments.update(storyId, savedId, {
          name: meta.name,
          description: meta.description,
          content: trimmed,
        })
      } else {
        const created = await api.fragments.create(storyId, {
          type: meta.fragmentType,
          name: meta.name,
          description: meta.description,
          content: trimmed,
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
      lastSavedRef.current = trimmed
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      onSaved(savedId!)
      return savedId
    } finally {
      setSaving(false)
    }
  }, [storyId, step, meta, queryClient, onSaved])

  // Auto-save when streaming completes.
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    const was = wasStreamingRef.current
    wasStreamingRef.current = gen.isStreaming
    if (was && !gen.isStreaming && gen.text.trim()) {
      save(gen.text)
    }
  }, [gen.isStreaming]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleContinue = async () => {
    if (content.trim()) await save(content)
    onContinue()
  }

  return (
    <StepShell step={step}>
      <div className="space-y-4">
        <Textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          onBlur={() => save(content)}
          disabled={gen.isStreaming}
          placeholder={meta.placeholder}
          className={`${meta.minHeight} bg-transparent text-base leading-relaxed resize-none border border-border/40 rounded-lg px-4 py-3 shadow-none focus-visible:ring-0 focus-visible:border-foreground/50 placeholder:text-muted-foreground/40 ${meta.font}`}
        />
        <AiAssistLink
          isStreaming={gen.isStreaming}
          onClick={() => gen.generate(buildPrompt(step, storyDesc, content))}
          onStop={gen.stop}
          label={content.trim() ? 'or let Errata draft a different one' : 'or let Errata draft this'}
          error={gen.error}
        />
      </div>

      <StepNav
        onBack={onBack}
        onContinue={handleContinue}
        canContinue={!saving && !gen.isStreaming}
      />
    </StepShell>
  )
}

// ── CharacterRow ──────────────────────────────────────

function CharacterRow({
  storyId,
  char,
  onChange,
  onDelete,
}: {
  storyId: string
  char: CharData
  onChange: (next: CharData) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(char.name)
  const [description, setDescription] = useState(char.description)
  const lastSyncedRef = useRef({ name: char.name, description: char.description })

  // If the parent pushes an updated char (e.g. streaming), sync local state.
  useEffect(() => {
    if (char.name !== lastSyncedRef.current.name) setName(char.name)
    if (char.description !== lastSyncedRef.current.description) setDescription(char.description)
    lastSyncedRef.current = { name: char.name, description: char.description }
  }, [char.name, char.description])

  const commit = useCallback(async () => {
    const nextName = name.trim()
    const nextDesc = description.trim() || nextName
    if (!nextName) return
    if (nextName === char.name && nextDesc === char.description) return

    let fragmentId = char.fragmentId
    try {
      if (fragmentId) {
        await api.fragments.update(storyId, fragmentId, {
          name: nextName,
          description: nextDesc.slice(0, 250),
          content: nextDesc,
        })
      } else {
        const created = await api.fragments.create(storyId, {
          type: 'character',
          name: nextName,
          description: nextDesc.slice(0, 250),
          content: nextDesc,
        })
        fragmentId = created.id
        await api.fragments.toggleSticky(storyId, fragmentId, true)
      }
    } catch {
      // best-effort; local state preserved so the next blur retries
    }
    onChange({ name: nextName, description: nextDesc, fragmentId })
  }, [name, description, char, storyId, onChange])

  return (
    <div className="group flex items-start gap-3 py-3 border-b border-border/20 last:border-b-0">
      <div className="flex-1 min-w-0 space-y-1">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commit}
          placeholder="a name"
          className="w-full bg-transparent font-display text-base italic outline-none placeholder:text-muted-foreground/30"
        />
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={commit}
          placeholder="a brief description — you can add more later"
          className="w-full bg-transparent font-prose text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/30"
        />
      </div>
      <button
        onClick={onDelete}
        aria-label="Remove character"
        className="mt-1 text-muted-foreground/30 hover:text-destructive/80 transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

// ── CharactersStep ────────────────────────────────────

function CharactersStep({
  storyId,
  characters,
  setCharacters,
  onContinue,
  onBack,
  storyDesc,
}: {
  storyId: string
  characters: CharData[]
  setCharacters: React.Dispatch<React.SetStateAction<CharData[]>>
  onContinue: () => void
  onBack: () => void
  storyDesc: string
}) {
  const queryClient = useQueryClient()
  const castGen = useGenerate(storyId)
  const seenStreamedNamesRef = useRef<Set<string>>(new Set())

  // As the cast streams in, progressively append parsed rows.
  useEffect(() => {
    if (!castGen.text) return
    const parsed = parseCastList(castGen.text)
    if (parsed.length === 0) return

    const seen = seenStreamedNamesRef.current
    const known = new Set(characters.map(c => c.name.toLowerCase()))
    const toAdd = parsed.filter(p => {
      const key = p.name.toLowerCase()
      return !known.has(key) && !seen.has(key)
    })
    if (toAdd.length === 0) return

    const appended: CharData[] = toAdd.map(p => {
      seen.add(p.name.toLowerCase())
      return { name: p.name, description: p.description, fragmentId: null }
    })
    setCharacters([...characters, ...appended])

    // Persist each new character in the background.
    for (const newChar of appended) {
      api.fragments.create(storyId, {
        type: 'character',
        name: newChar.name,
        description: newChar.description.slice(0, 250),
        content: newChar.description,
      }).then(async created => {
        await api.fragments.toggleSticky(storyId, created.id, true)
        setCharacters(current => current.map(c =>
          c.name === newChar.name && c.fragmentId === null
            ? { ...c, fragmentId: created.id }
            : c,
        ))
        queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      }).catch(() => { /* best effort */ })
    }
  }, [castGen.text]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSummon = () => {
    seenStreamedNamesRef.current = new Set(characters.map(c => c.name.toLowerCase()))
    const storyContext = storyDesc ? `\nStory concept: ${storyDesc}` : ''
    const existing = characters.length > 0
      ? `\nAvoid duplicating: ${characters.map(c => c.name).join(', ')}`
      : ''
    castGen.generate(
      `[WIZARD SETUP — NOT a prose request]\nSuggest 3–5 characters. For each: "Name — one-line personality and appearance". One per line. Output ONLY the list, nothing else.${storyContext}${existing}`,
    )
  }

  const handleAddBlank = () => {
    setCharacters([...characters, { name: '', description: '', fragmentId: null }])
  }

  const handleChange = (index: number, next: CharData) => {
    const updated = [...characters]
    updated[index] = next
    setCharacters(updated)
  }

  const handleDelete = async (index: number) => {
    const char = characters[index]
    if (char.fragmentId) {
      try {
        await api.fragments.delete(storyId, char.fragmentId)
        await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      } catch { /* best-effort */ }
    }
    setCharacters(characters.filter((_, i) => i !== index))
  }

  return (
    <StepShell step="characters">
      <div className="space-y-4">
        {characters.length > 0 ? (
          <div>
            {characters.map((char, i) => (
              <CharacterRow
                key={char.fragmentId ?? `draft-${i}`}
                storyId={storyId}
                char={char}
                onChange={next => handleChange(i, next)}
                onDelete={() => handleDelete(i)}
              />
            ))}
          </div>
        ) : (
          <EmptyHint size="sm" className="py-4">
            No characters yet.
          </EmptyHint>
        )}

        <div className="flex items-center gap-5 pt-1">
          <button
            onClick={handleAddBlank}
            disabled={castGen.isStreaming}
            className="flex items-center gap-1.5 text-xs font-display italic text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <Plus className="size-3" aria-hidden /> add a character
          </button>
          <span className="text-muted-foreground/40 text-xs">·</span>
          <AiAssistLink
            isStreaming={castGen.isStreaming}
            onClick={handleSummon}
            onStop={castGen.stop}
            label="or let Errata summon a few"
            streamingLabel="summoning"
            error={castGen.error}
          />
        </div>
      </div>

      <StepNav onBack={onBack} onContinue={onContinue} canContinue={!castGen.isStreaming} />
    </StepShell>
  )
}

// ── PreferencesStep ───────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description: string
}) {
  return (
    <label className="flex items-start gap-4 cursor-pointer group">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
          checked
            ? 'bg-primary/80 border-primary/70'
            : 'bg-muted/50 border-border/60 group-hover:bg-muted/80'
        }`}
      >
        <span
          className={`inline-block size-3.5 rounded-full bg-background shadow-sm transition-transform ${
            checked ? 'translate-x-[1.125rem]' : 'translate-x-[0.1875rem]'
          }`}
        />
      </button>
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="font-display text-base italic leading-snug">{label}</p>
        <Caption className="font-prose leading-relaxed">{description}</Caption>
      </div>
    </label>
  )
}

function PreferencesStep({
  storyId,
  onContinue,
  onBack,
}: {
  storyId: string
  onContinue: () => void
  onBack: () => void
}) {
  const queryClient = useQueryClient()
  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })
  const mutation = useMutation({
    mutationFn: (data: { generationMode: 'standard' | 'prewriter' }) => api.settings.update(storyId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['story', storyId] }),
  })
  const prewriter = (story?.settings.generationMode ?? 'prewriter') === 'prewriter'

  return (
    <StepShell step="preferences">
      <div className="space-y-10">
        <Toggle
          checked={prewriter}
          onChange={v => mutation.mutate({ generationMode: v ? 'prewriter' : 'standard' })}
          label="Prewriter mode"
          description="A planner agent reads your full context first and writes a focused brief for the writer. Better character voices and continuity — slightly slower."
        />

        <p className="text-xs font-display italic text-muted-foreground">
          Everything else lives in Settings.
        </p>
      </div>

      <StepNav onBack={onBack} onContinue={onContinue} />
    </StepShell>
  )
}

// ── CompleteStep ──────────────────────────────────────

function CompleteStep({
  onComplete,
  onBack,
}: {
  onComplete: () => void
  onBack: () => void
}) {
  return (
    <StepShell step="complete">
      <div className="min-h-[160px]" />
      <StepNav onBack={onBack} onContinue={onComplete} continueLabel="Open story →" />
    </StepShell>
  )
}

// ── Main Wizard ───────────────────────────────────────

export function StoryWizard({ storyId, onComplete }: StoryWizardProps) {
  const [step, setStep] = useState<WizardStep>('concept')
  const [initialized, setInitialized] = useState(false)

  const [storyName, setStoryName] = useState('')
  const [storyDesc, setStoryDesc] = useState('')
  const [guidelineContent, setGuidelineContent] = useState('')
  const [guidelineId, setGuidelineId] = useState<string | null>(null)
  const [worldContent, setWorldContent] = useState('')
  const [worldId, setWorldId] = useState<string | null>(null)
  const [characters, setCharacters] = useState<CharData[]>([])
  const [proseContent, setProseContent] = useState('')
  const [proseId, setProseId] = useState<string | null>(null)

  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })
  const { data: existingFragments } = useQuery({
    queryKey: ['wizard-fragments', storyId],
    queryFn: () => api.fragments.list(storyId),
  })

  useEffect(() => {
    if (!story) return
    if (!storyName) setStoryName(story.name === 'New Story' ? '' : story.name)
    if (!storyDesc) setStoryDesc(story.description)
  }, [story]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!existingFragments || initialized) return
    setInitialized(true)

    const gl = existingFragments.find(f => f.type === 'guideline')
    if (gl) { setGuidelineContent(gl.content); setGuidelineId(gl.id) }

    const world = existingFragments.find(f => f.type === 'knowledge' && f.sticky)
    if (world) { setWorldContent(world.content); setWorldId(world.id) }

    const chars = existingFragments.filter(f => f.type === 'character')
    if (chars.length > 0) {
      setCharacters(chars.map(c => ({
        name: c.name,
        description: c.description || '',
        fragmentId: c.id,
      })))
    }

    const prose = existingFragments.find(f => f.type === 'prose')
    if (prose) { setProseContent(prose.content); setProseId(prose.id) }
  }, [existingFragments, initialized])

  const goTo = (s: WizardStep) => setStep(s)

  const countedIndex = COUNTED_STEPS.indexOf(step as (typeof COUNTED_STEPS)[number])
  const showProgress = countedIndex >= 0

  return (
    <Wizard step={step} total={COUNTED_STEPS.length} onClose={onComplete}>
      <Wizard.Toolbar>
        {showProgress
          ? <Wizard.Progress current={countedIndex + 1} total={COUNTED_STEPS.length} />
          : <span />
        }
        <Wizard.SkipButton onClick={onComplete} />
      </Wizard.Toolbar>

      <Wizard.Step stepKey="concept">
        <ConceptStep
          storyId={storyId}
          storyName={storyName}
          setStoryName={setStoryName}
          storyDesc={storyDesc}
          setStoryDesc={setStoryDesc}
          onContinue={() => goTo('guideline')}
        />
      </Wizard.Step>

      <Wizard.Step stepKey="guideline">
        <ContentStep
          key="guideline"
          storyId={storyId}
          step="guideline"
          content={guidelineContent}
          setContent={setGuidelineContent}
          fragmentId={guidelineId}
          onSaved={setGuidelineId}
          onContinue={() => goTo('world')}
          onBack={() => goTo('concept')}
          storyDesc={storyDesc}
        />
      </Wizard.Step>

      <Wizard.Step stepKey="world">
        <ContentStep
          key="world"
          storyId={storyId}
          step="world"
          content={worldContent}
          setContent={setWorldContent}
          fragmentId={worldId}
          onSaved={setWorldId}
          onContinue={() => goTo('characters')}
          onBack={() => goTo('guideline')}
          storyDesc={storyDesc}
        />
      </Wizard.Step>

      <Wizard.Step stepKey="characters">
        <CharactersStep
          storyId={storyId}
          characters={characters}
          setCharacters={setCharacters}
          onContinue={() => goTo('preferences')}
          onBack={() => goTo('world')}
          storyDesc={storyDesc}
        />
      </Wizard.Step>

      <Wizard.Step stepKey="preferences">
        <PreferencesStep
          storyId={storyId}
          onContinue={() => goTo('prose')}
          onBack={() => goTo('characters')}
        />
      </Wizard.Step>

      <Wizard.Step stepKey="prose">
        <ContentStep
          key="prose"
          storyId={storyId}
          step="prose"
          content={proseContent}
          setContent={setProseContent}
          fragmentId={proseId}
          onSaved={setProseId}
          onContinue={() => goTo('complete')}
          onBack={() => goTo('preferences')}
          storyDesc={storyDesc}
        />
      </Wizard.Step>

      <Wizard.Step stepKey="complete">
        <CompleteStep
          onComplete={onComplete}
          onBack={() => goTo('prose')}
        />
      </Wizard.Step>
    </Wizard>
  )
}
