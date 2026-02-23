import { useEffect, useState, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTheme, useFontPreferences, getActiveFont, FONT_CATALOGUE, loadFullFontCatalogue } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import {
  Sun,
  Moon,
  Layers,
  Sparkles,
  Puzzle,
  ArrowLeft,
  RefreshCw,
  Loader2,
  Zap,
  Check,
  Server,
  BookOpen,
  GitBranch,
} from 'lucide-react'

// ── Guilloche background ─────────────────────────────

/** A closed ring whose radius oscillates sinusoidally — many concentric rings = parallel flowing waves. */
function wavyRingPath(baseR: number, amplitude: number, waves: number, steps: number): string {
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const θ = (i / steps) * 2 * Math.PI
    const r = baseR + amplitude * Math.sin(waves * θ)
    pts.push(`${(r * Math.cos(θ)).toFixed(1)},${(r * Math.sin(θ)).toFixed(1)}`)
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' ')} Z`
}

/** Two wave-groups with coprime frequencies create the classic guilloche interference. */
const GUILLOCHE_GROUPS = [
  { waves: 5, amplitude: 18, rMin: 40, rMax: 270, spacing: 11, dur: 180, rev: false },
  { waves: 7, amplitude: 14, rMin: 45, rMax: 265, spacing: 11, dur: 240, rev: true },
] as const

function GuillocheBackground() {
  const groups = useMemo(
    () => GUILLOCHE_GROUPS.map((g) => {
      const paths: string[] = []
      for (let r = g.rMin; r <= g.rMax; r += g.spacing) {
        paths.push(wavyRingPath(r, g.amplitude, g.waves, 360))
      }
      return paths
    }),
    [],
  )

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none animate-guilloche-breathe" aria-hidden="true">
      <svg
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[140%] h-[140%]"
        viewBox="-300 -300 600 600"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="g-fade">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="50%" stopColor="white" stopOpacity="0.6" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="g-mask">
            <rect x="-300" y="-300" width="600" height="600" fill="url(#g-fade)" />
          </mask>
        </defs>
        <g mask="url(#g-mask)">
          {GUILLOCHE_GROUPS.map((group, gi) => (
            <g
              key={gi}
              className={group.rev ? 'animate-guilloche-reverse' : 'animate-guilloche'}
              style={{ animationDuration: `${group.dur}s` }}
            >
              {groups[gi].map((d, ri) => (
                <path
                  key={ri}
                  d={d}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="0.4"
                  strokeOpacity="0.06"
                />
              ))}
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}

// ── Provider card data ────────────────────────────────

const PROVIDER_CARDS = {
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    description: 'Fast and affordable. Great default for fiction writing.',
    accent: 'blue',
    customHeaders: {},
  },
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.2',
    description: 'GPT-5.2 and Codex. The most capable models for professional work.',
    accent: 'emerald',
    customHeaders: {},
  },
  anthropic: {
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-opus-4-6',
    description: 'Claude Opus 4.6. Nuanced writing with 1M token context.',
    accent: 'amber',
    customHeaders: {},
  },
  kimi: {
    name: 'Kimi',
    baseURL: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.5',
    description: 'Moonshot K2.5. Powerful open model, great value.',
    accent: 'cyan',
    customHeaders: {},
  },
  'kimi-code': {
    name: 'Kimi Code',
    baseURL: 'https://api.kimi.com/coding/v1',
    defaultModel: 'kimi-for-coding',
    description: 'Kimi Code CLI. Optimized for coding and agentic tasks.',
    accent: 'rose',
    customHeaders: { 'User-Agent': 'claude-code/1.0' } as Record<string, string>,
  },
  openrouter: {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat-v3-0324',
    description: 'Access hundreds of models through one API.',
    accent: 'purple',
    customHeaders: {},
  },
  custom: {
    name: 'Custom',
    baseURL: '',
    defaultModel: '',
    description: 'Any OpenAI-compatible endpoint. Full control.',
    accent: 'neutral',
    customHeaders: {},
  },
} as const

type PresetKey = keyof typeof PROVIDER_CARDS

const ACCENT_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  blue: { border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  emerald: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  amber: { border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  cyan: { border: 'border-cyan-500/30', bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  rose: { border: 'border-rose-500/30', bg: 'bg-rose-500/10', text: 'text-rose-400' },
  purple: { border: 'border-purple-500/30', bg: 'bg-purple-500/10', text: 'text-purple-400' },
  neutral: { border: 'border-border/50', bg: 'bg-muted/30', text: 'text-muted-foreground' },
}

// ── Shared styles ─────────────────────────────────────

const inputClass =
  'w-full h-9 px-3 text-sm bg-background border border-border/40 rounded-md focus:border-primary/30 focus:outline-none'
const labelClass = 'text-xs font-medium text-muted-foreground mb-1.5 block'

// ── Main Wizard ───────────────────────────────────────

interface OnboardingWizardProps {
  onComplete: () => void
}

type Step = 'theme' | 'typography' | 'welcome' | 'provider-select' | 'provider-setup'

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('theme')
  const [selectedPreset, setSelectedPreset] = useState<PresetKey | null>(null)

  return (
    <div className="fixed inset-0 bg-background z-50" data-component-id="onboarding-root">
      <GuillocheBackground />
      <div className="relative z-10 flex items-center justify-center h-full overflow-auto">
        {step === 'theme' && (
          <ThemeStep
            onNext={() => setStep('typography')}
          />
        )}
        {step === 'typography' && (
          <TypographyStep
            onNext={() => setStep('welcome')}
            onBack={() => setStep('theme')}
          />
        )}
        {step === 'welcome' && (
          <WelcomeStep
            onNext={() => setStep('provider-select')}
          />
        )}
        {step === 'provider-select' && (
          <ProviderSelectStep
            onSelect={(preset) => {
              setSelectedPreset(preset)
              setStep('provider-setup')
            }}
            onBack={() => setStep('welcome')}
          />
        )}
        {step === 'provider-setup' && selectedPreset && (
          <ProviderSetupStep
            preset={selectedPreset}
            onComplete={onComplete}
            onBack={() => setStep('provider-select')}
          />
        )}
      </div>
    </div>
  )
}

// ── Step 0: Theme Selection ───────────────────────────

function ThemeStep({
  onNext,
}: {
  onNext: () => void
}) {
  const { theme, setTheme } = useTheme()

  return (
    <div className="max-w-md mx-auto text-center px-6">
      <div className="animate-onboarding-fade-up">
        <h1 className="font-display text-5xl italic tracking-tight mb-3">Errata</h1>
        <p className="font-prose text-lg text-muted-foreground mb-12">
          How do you like to read?
        </p>
      </div>

      <div
        className="grid grid-cols-2 gap-4 mb-10 animate-onboarding-fade-up"
        style={{ animationDelay: '150ms' }}
      >
        <button
          onClick={() => setTheme('light')}
          className={`group relative flex flex-col items-center gap-3 p-6 rounded-xl border transition-all duration-200 cursor-pointer ${
            theme === 'light'
              ? 'border-primary/40 bg-primary/5 shadow-sm'
              : 'border-border/30 hover:border-border/60 hover:bg-card/50'
          }`}
          data-component-id="onboarding-theme-light"
        >
          <div
            className={`size-12 rounded-full flex items-center justify-center transition-colors ${
              theme === 'light'
                ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <Sun className="size-5" />
          </div>
          <span className="text-sm font-medium">Light</span>
          {theme === 'light' && (
            <div className="absolute top-2.5 right-2.5 size-5 rounded-full bg-primary flex items-center justify-center">
              <Check className="size-3 text-primary-foreground" />
            </div>
          )}
        </button>

        <button
          onClick={() => setTheme('dark')}
          className={`group relative flex flex-col items-center gap-3 p-6 rounded-xl border transition-all duration-200 cursor-pointer ${
            theme === 'dark'
              ? 'border-primary/40 bg-primary/5 shadow-sm'
              : 'border-border/30 hover:border-border/60 hover:bg-card/50'
          }`}
          data-component-id="onboarding-theme-dark"
        >
          <div
            className={`size-12 rounded-full flex items-center justify-center transition-colors ${
              theme === 'dark'
                ? 'bg-indigo-500/20 text-indigo-400'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <Moon className="size-5" />
          </div>
          <span className="text-sm font-medium">Dark</span>
          {theme === 'dark' && (
            <div className="absolute top-2.5 right-2.5 size-5 rounded-full bg-primary flex items-center justify-center">
              <Check className="size-3 text-primary-foreground" />
            </div>
          )}
        </button>
      </div>

      <div
        className="animate-onboarding-fade-up"
        style={{ animationDelay: '300ms' }}
      >
        <Button onClick={onNext} className="px-8" data-component-id="onboarding-theme-continue">
          Continue
        </Button>
      </div>
    </div>
  )
}

// ── Step 0.5: Typography Selection ────────────────────

const PROSE_SAMPLE = 'The morning light fell across the desk, illuminating pages scattered in careless heaps. She picked up her pen.'

function TypographyStep({
  onNext,
  onBack,
}: {
  onNext: () => void
  onBack: () => void
}) {
  useEffect(() => { loadFullFontCatalogue() }, [])
  const [fontPrefs, setFont] = useFontPreferences()
  const activeProse = getActiveFont('prose', fontPrefs)
  const activeDisplay = getActiveFont('display', fontPrefs)

  return (
    <div className="max-w-xl mx-auto px-6">
      <div className="text-center mb-10 animate-onboarding-fade-up">
        <h2 className="font-display text-3xl italic mb-2">Choose your typeface</h2>
        <p className="text-sm text-muted-foreground">
          The reading font shapes your entire writing experience.
        </p>
      </div>

      {/* Prose fonts — the main event */}
      <div className="mb-8">
        <p
          className="text-[0.625rem] text-muted-foreground uppercase tracking-wider mb-3 animate-onboarding-fade-up"
          style={{ animationDelay: '100ms' }}
        >
          Prose
        </p>
        <div className="grid grid-cols-2 gap-3">
          {FONT_CATALOGUE.prose.map((opt, i) => {
            const isActive = opt.name === activeProse
            return (
              <button
                key={opt.name}
                onClick={() => setFont('prose', opt.name)}
                className={`group relative text-left p-4 rounded-xl border transition-all duration-200 cursor-pointer animate-onboarding-fade-up ${
                  isActive
                    ? 'border-primary/40 bg-primary/5 shadow-sm'
                    : 'border-border/30 hover:border-border/60 hover:bg-card/50'
                }`}
                style={{ animationDelay: `${150 + i * 80}ms` }}
              >
                <p className="text-[0.6875rem] font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  {opt.name}
                  {opt.tag && (
                    <span className="text-[0.5rem] font-medium uppercase tracking-wider text-primary/60 bg-primary/8 px-1.5 py-px rounded-full leading-tight">
                      {opt.tag}
                    </span>
                  )}
                </p>
                <p
                  className="text-[0.9375rem] leading-relaxed text-foreground/80"
                  style={{ fontFamily: `"${opt.name}", ${opt.fallback}` }}
                >
                  {PROSE_SAMPLE}
                </p>
                {isActive && (
                  <div className="absolute top-2.5 right-2.5 size-5 rounded-full bg-primary flex items-center justify-center animate-onboarding-scale-in">
                    <Check className="size-3 text-primary-foreground" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Display fonts — secondary */}
      <div className="mb-10">
        <p
          className="text-[0.625rem] text-muted-foreground uppercase tracking-wider mb-3 animate-onboarding-fade-up"
          style={{ animationDelay: '500ms' }}
        >
          Headings
        </p>
        <div
          className="grid grid-cols-3 gap-3 animate-onboarding-fade-up"
          style={{ animationDelay: '550ms' }}
        >
          {FONT_CATALOGUE.display.map((opt) => {
            const isActive = opt.name === activeDisplay
            return (
              <button
                key={opt.name}
                onClick={() => setFont('display', opt.name)}
                className={`relative text-center p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'border-primary/40 bg-primary/5 shadow-sm'
                    : 'border-border/30 hover:border-border/60 hover:bg-card/50'
                }`}
              >
                <p
                  className="text-xl italic mb-1 text-foreground/85"
                  style={{ fontFamily: `"${opt.name}", ${opt.fallback}` }}
                >
                  Chapter One
                </p>
                <p className="text-[0.625rem] text-muted-foreground flex items-center justify-center gap-1">
                  {opt.name}
                  {opt.tag && (
                    <span className="text-[0.4375rem] font-medium uppercase tracking-wider text-primary/60 bg-primary/8 px-1 py-px rounded-full leading-tight">
                      {opt.tag}
                    </span>
                  )}
                </p>
                {isActive && (
                  <div className="absolute top-2 right-2 size-4 rounded-full bg-primary flex items-center justify-center animate-onboarding-scale-in">
                    <Check className="size-2.5 text-primary-foreground" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div
        className="text-center animate-onboarding-fade-up"
        style={{ animationDelay: '650ms' }}
      >
        <Button onClick={onNext} className="px-8">
          Continue
        </Button>
        <div className="mt-4">
          <button
            onClick={onBack}
            className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors flex items-center gap-1"
          >
            <ArrowLeft className="size-3" /> Back
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Step 1: Welcome ───────────────────────────────────

function WelcomeStep({
  onNext,
}: {
  onNext: () => void
}) {
  const { theme, toggle } = useTheme()

  return (
    <div className="max-w-xl mx-auto text-center px-6 relative">
      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="absolute -top-12 right-0 size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-muted-foreground hover:bg-card/50 transition-all"
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      </button>

      <div className="animate-onboarding-fade-up">
        <h1 className="font-display text-5xl italic tracking-tight mb-3">Errata</h1>
        <p className="font-prose text-lg text-muted-foreground">
          Model-assisted writing, built around fragments.
        </p>
      </div>

      {/* Hero features: Librarian & Timelines */}
      <div className="mt-10 grid grid-cols-2 gap-4">
        <div
          className="text-left p-5 rounded-xl border border-primary/15 bg-primary/[0.03] animate-onboarding-fade-up"
          style={{ animationDelay: '200ms' }}
        >
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <BookOpen className="size-5 text-primary" />
          </div>
          <p className="text-sm font-medium mb-1">The Librarian</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            A background AI reads every generation &mdash; tracking characters,
            contradictions, and world details into a living story reference.
          </p>
        </div>
        <div
          className="text-left p-5 rounded-xl border border-primary/15 bg-primary/[0.03] animate-onboarding-fade-up"
          style={{ animationDelay: '320ms' }}
        >
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <GitBranch className="size-5 text-primary" />
          </div>
          <p className="text-sm font-medium mb-1">Timelines</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Fork at any point to explore alternate paths. Each timeline
            carries its own fragments, prose, and accumulated knowledge.
          </p>
        </div>
      </div>

      {/* Supporting features */}
      <div className="mt-4 space-y-3">
        {[
          { icon: Layers, title: 'Fragments', desc: 'Prose, characters, guidelines, knowledge — everything is a composable fragment.' },
          { icon: Sparkles, title: 'Generation', desc: 'Fragments compose into rich context for nuanced story continuations.' },
          { icon: Puzzle, title: 'Plugins', desc: 'Extend with custom fragment types, tools, and pipeline hooks.' },
        ].map((f, i) => (
          <div
            key={f.title}
            className="flex items-start gap-4 text-left p-4 rounded-lg border border-border/20 bg-card/30 animate-onboarding-fade-up"
            style={{ animationDelay: `${450 + i * 100}ms` }}
          >
            <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <f.icon className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium mb-0.5">{f.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div
        className="mt-10 animate-onboarding-fade-up"
        style={{ animationDelay: '800ms' }}
      >
        <Button onClick={onNext} className="px-8" data-component-id="onboarding-welcome-start">
          Get Started
        </Button>
      </div>
    </div>
  )
}

// ── Step 2: Provider Selection ────────────────────────

function ProviderSelectStep({
  onSelect,
  onBack,
}: {
  onSelect: (preset: PresetKey) => void
  onBack: () => void
}) {
  const cards = Object.entries(PROVIDER_CARDS) as [PresetKey, (typeof PROVIDER_CARDS)[PresetKey]][]

  return (
    <div className="max-w-2xl mx-auto px-6">
      <div className="text-center mb-8 animate-onboarding-fade-up">
        <h2 className="font-display text-3xl italic mb-2">Choose your provider</h2>
        <p className="text-sm text-muted-foreground">
          Pick an LLM provider to power your writing. You can always add more later.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(([key, card], i) => {
          const accent = ACCENT_COLORS[card.accent]
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={`relative text-left p-5 rounded-xl border border-border/30 bg-card/30 hover:border-border/60 hover:bg-card/80 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer animate-onboarding-fade-up group`}
              style={{ animationDelay: `${100 + i * 80}ms` }}
            >
              {/* Accent strip */}
              <div className={`absolute top-0 left-4 right-4 h-0.5 rounded-b ${accent.bg}`} />

              <div className="flex items-start gap-3">
                <div
                  className={`size-9 rounded-lg ${accent.bg} flex items-center justify-center shrink-0`}
                >
                  <Server className={`size-4 ${accent.text}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{card.name}</span>
                    {card.defaultModel && (
                      <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">
                        {card.defaultModel}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {card.description}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div
        className="flex items-center justify-center mt-8 animate-onboarding-fade-up"
        style={{ animationDelay: '500ms' }}
      >
        <button
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="size-3" /> Back
        </button>
      </div>
    </div>
  )
}

// ── Step 3: Provider Setup Form ───────────────────────

function ProviderSetupStep({
  preset,
  onComplete,
  onBack,
}: {
  preset: PresetKey
  onComplete: () => void
  onBack: () => void
}) {
  const card = PROVIDER_CARDS[preset]
  const accent = ACCENT_COLORS[card.accent]

  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState<string>(card.baseURL)
  const [defaultModel, setDefaultModel] = useState<string>(card.defaultModel)
  const [name, setName] = useState<string>(card.name || '')

  const [fetchedModels, setFetchedModels] = useState<Array<{ id: string; owned_by?: string }>>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [useCustomModel, setUseCustomModel] = useState(preset === 'custom')

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    reply?: string
    error?: string
  } | null>(null)

  const [success, setSuccess] = useState(false)

  const addMutation = useMutation({
    mutationFn: (data: {
      name: string
      preset?: string
      baseURL: string
      apiKey: string
      defaultModel: string
      customHeaders?: Record<string, string>
    }) => api.config.addProvider(data),
    onSuccess: () => {
      // Don't invalidate yet — let the celebration screen show first.
      // The parent will invalidate when onComplete is called.
      setSuccess(true)
    },
  })

  const handleFetchModels = async () => {
    setFetchingModels(true)
    setFetchError(null)
    try {
      const result = await api.config.testModels({ baseURL, apiKey, customHeaders: cardHeaders })
      if (result.error) {
        setFetchError(result.error)
      } else {
        setFetchedModels(result.models)
        setUseCustomModel(false)
        // Auto-select first model if current selection is empty or not in the list
        if (result.models.length > 0 && (!defaultModel || !result.models.some(m => m.id === defaultModel))) {
          setDefaultModel(result.models[0].id)
        }
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch models')
    } finally {
      setFetchingModels(false)
    }
  }

  const handleTestConnection = async () => {
    if (!defaultModel) {
      setTestResult({ ok: false, error: 'Model is required to test' })
      return
    }
    if (!baseURL || !apiKey) {
      setTestResult({ ok: false, error: 'Base URL and API Key are required' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.config.testConnection({
        baseURL,
        apiKey,
        model: defaultModel,
        customHeaders: cardHeaders,
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const cardHeaders = card.customHeaders as Record<string, string>

  const handleSave = () => {
    const providerName = name || card.name || preset
    addMutation.mutate({
      name: providerName,
      preset,
      baseURL,
      apiKey,
      defaultModel,
      ...(Object.keys(cardHeaders).length > 0 ? { customHeaders: cardHeaders } : {}),
    })
  }

  const canSave = (preset === 'custom' ? name.trim() : true) && baseURL && apiKey && defaultModel

  // ── Success celebration ──
  if (success) {
    return (
      <div className="max-w-md mx-auto text-center px-6">
        <div className="animate-onboarding-check mb-6">
          <div className="size-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
            <Check className="size-8 text-emerald-500" />
          </div>
        </div>
        <h2
          className="font-display text-3xl italic mb-2 animate-onboarding-fade-up"
          style={{ animationDelay: '200ms' }}
        >
          You're all set!
        </h2>
        <p
          className="text-sm text-muted-foreground mb-8 animate-onboarding-fade-up"
          style={{ animationDelay: '350ms' }}
        >
          {card.name || name} is configured and ready to go. You can manage providers anytime in
          settings.
        </p>
        <div className="animate-onboarding-fade-up" style={{ animationDelay: '500ms' }}>
          <Button onClick={onComplete} className="px-8">
            Start Writing
          </Button>
        </div>
      </div>
    )
  }

  // ── Form ──
  return (
    <div className="max-w-md mx-auto px-6 w-full">
      <div className="text-center mb-8 animate-onboarding-fade-up">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className={`size-7 rounded-lg ${accent.bg} flex items-center justify-center`}>
            <Server className={`size-3.5 ${accent.text}`} />
          </div>
          <h2 className="font-display text-3xl italic">
            {preset === 'custom' ? 'Custom Provider' : card.name}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Enter your credentials to get started.
        </p>
      </div>

      <div
        className="space-y-4 animate-onboarding-fade-up"
        style={{ animationDelay: '100ms' }}
      >
        {/* Name (only for custom) */}
        {preset === 'custom' && (
          <div>
            <label className={labelClass}>Provider Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="My Provider"
            />
          </div>
        )}

        {/* API Key */}
        <div>
          <label className={labelClass}>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={inputClass}
            placeholder="Enter your API key"
            autoFocus
          />
        </div>

        {/* Base URL */}
        <div>
          <label className={labelClass}>Base URL</label>
          <input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            className={inputClass}
            placeholder="https://api.example.com/v1"
          />
        </div>

        {/* Default Model */}
        <div>
          <label className={labelClass}>Default Model</label>
          <div className="flex gap-2">
            {fetchedModels.length > 0 && !useCustomModel ? (
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className={inputClass + ' flex-1'}
              >
                {!fetchedModels.some((m) => m.id === defaultModel) && defaultModel && (
                  <option value={defaultModel}>{defaultModel} (current)</option>
                )}
                {fetchedModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                    {m.owned_by ? ` (${m.owned_by})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className={inputClass + ' flex-1'}
                placeholder="e.g. deepseek-chat"
              />
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 text-xs gap-1.5 shrink-0"
              onClick={handleFetchModels}
              disabled={fetchingModels || !baseURL || !apiKey}
            >
              {fetchingModels ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              Fetch
            </Button>
          </div>
          {fetchedModels.length > 0 && (
            <button
              type="button"
              className="text-[0.6875rem] text-muted-foreground hover:text-muted-foreground mt-1 underline"
              onClick={() => setUseCustomModel(!useCustomModel)}
            >
              {useCustomModel ? 'Use fetched models' : 'Enter model ID manually'}
            </button>
          )}
          {fetchError && <p className="text-xs text-destructive mt-1">{fetchError}</p>}
          {fetchedModels.length > 0 && !fetchError && (
            <p className="text-[0.6875rem] text-muted-foreground mt-1">
              {fetchedModels.length} models available
            </p>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div
            className={`text-sm rounded-md p-3 ${testResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive'}`}
          >
            {testResult.ok ? (
              <p>
                <span className="font-medium">Success:</span> {testResult.reply}
              </p>
            ) : (
              <p>
                <span className="font-medium">Error:</span> {testResult.error}
              </p>
            )}
          </div>
        )}

        {/* Mutation error */}
        {addMutation.isError && (
          <div className="text-sm rounded-md p-3 bg-destructive/10 text-destructive">
            <p>
              <span className="font-medium">Error:</span>{' '}
              {addMutation.error instanceof Error ? addMutation.error.message : 'Failed to save'}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} disabled={!canSave || addMutation.isPending} className="flex-1">
            {addMutation.isPending ? 'Saving...' : 'Save & Continue'}
          </Button>
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || !defaultModel || !apiKey || !baseURL}
            className="gap-1.5"
          >
            {testing ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
            Test
          </Button>
        </div>
      </div>

      <div
        className="flex items-center justify-center mt-8 animate-onboarding-fade-up"
        style={{ animationDelay: '250ms' }}
      >
        <button
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="size-3" /> Back
        </button>
      </div>
    </div>
  )
}
