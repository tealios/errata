import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta, type GlobalConfigSafe } from '@/lib/api'
import { useTheme, useQuickSwitch, useCharacterMentions, useTimelineBar, useProseWidth, useUiFontSize, UI_FONT_SIZE_LABELS, useProseFontSize, PROSE_FONT_SIZE_LABELS, useFontPreferences, getActiveFont, FONT_CATALOGUE, loadFullFontCatalogue, useCustomCss, useWritingTransforms, useTransformContext, TRANSFORM_CONTEXT_LABELS, type TransformContext, type FontRole, type ProseWidth, type UiFontSize, type ProseFontSize } from '@/lib/theme'
import { Settings2, ChevronRight, ExternalLink, Eye, EyeOff, Puzzle, RotateCcw, CircleHelp, Code } from 'lucide-react'
import { useHelp } from '@/hooks/use-help'
import { CustomCssPanel } from '@/components/settings/CustomCssPanel'
import { TtsSettings } from '@/components/settings/TtsSettings'
import { SharingPanel } from '@/components/settings/SharingPanel'
import { ProseColorsControls } from '@/components/settings/ProseColorsPanel'
import { CustomTransformsControls } from '@/components/settings/CustomTransformsPanel'
import { DesktopUpdatesControls } from '@/components/settings/DesktopUpdatesPanel'
import { ModelSelect } from '@/components/settings/ModelSelect'
import { ProviderSelect } from '@/components/settings/ProviderSelect'
import { resolveProvider, getInheritLabel } from '@/lib/model-role-helpers'
import {
  SettingsSection,
  SectionHeading,
  SettingsCard,
  SettingRow,
  Toggle,
  SegmentedControl,
  NumberField,
} from '@/components/settings/primitives'

interface SettingsPanelProps {
  storyId: string
  story: StoryMeta
  onManageProviders: () => void
  onOpenPluginPanel?: (pluginName: string) => void
  onTogglePluginSidebar?: (pluginName: string, visible: boolean) => void
  pluginSidebarVisibility?: Record<string, boolean>
}


function SettingsGroup({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/30 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/20 bg-muted/20">
        <p className="text-[0.625rem] uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
        {description && <p className="text-[0.6875rem] text-muted-foreground mt-0.5 leading-snug">{description}</p>}
      </div>
      <div className="divide-y divide-border/20">
        {children}
      </div>
    </div>
  )
}

function FontPicker({ role, label, description, activeFont, onSelect }: {
  role: FontRole
  label: string
  description: string
  activeFont: string
  onSelect: (name: string) => void
}) {
  useEffect(() => { loadFullFontCatalogue() }, [])
  const options = FONT_CATALOGUE[role]
  return (
    <div className="px-3 py-2.5">
      <p className="text-[0.75rem] font-medium text-foreground/80 mb-0.5">{label}</p>
      <p className="text-[0.625rem] text-muted-foreground mb-2 leading-snug">{description}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const isActive = opt.name === activeFont
          return (
            <button
              key={opt.name}
              onClick={() => onSelect(opt.name)}
              style={{ fontFamily: `"${opt.name}", ${opt.fallback}` }}
              className={`px-2.5 py-1 rounded-md text-[0.75rem] border transition-all duration-150 inline-flex items-center gap-1.5 ${isActive
                  ? 'border-foreground/25 bg-foreground/5 text-foreground shadow-[0_0_0_1px_var(--foreground)/5]'
                  : 'border-transparent text-muted-foreground hover:text-foreground/70 hover:bg-accent/30'
                }`}
            >
              {opt.name}
              {opt.tag && (
                <span className="text-[0.5rem] font-sans font-medium uppercase tracking-wider text-primary/60 bg-primary/8 px-1.5 py-px rounded-full leading-tight">
                  {opt.tag}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}


function LLMSection({ story, globalConfig, updateMutation, onManageProviders }: {
  story: StoryMeta
  globalConfig: GlobalConfigSafe | null
  updateMutation: { mutate: (data: Parameters<typeof api.settings.update>[1]) => void; isPending: boolean }
  onManageProviders: () => void
}) {
  const { openHelp } = useHelp()
  const settings = story.settings
  const overrides = settings.modelOverrides ?? {}

  const { data: modelRoles } = useQuery({
    queryKey: ['model-roles'],
    queryFn: () => api.agentBlocks.listModelRoles(),
  })

  const roles = modelRoles ?? []

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <label className="text-[0.625rem] text-muted-foreground uppercase tracking-wider">LLM</label>
        <button
          type="button"
          onClick={() => openHelp('settings#providers')}
          className="text-muted-foreground hover:text-primary/60 transition-colors"
          title="About model configuration"
        >
          <CircleHelp className="size-3" />
        </button>
      </div>
      <div className="rounded-lg border border-border/30 divide-y divide-border/20">
        {roles.map((role) => {
          const directProviderId = overrides[role.key]?.providerId ?? null
          const directModelId = overrides[role.key]?.modelId ?? null
          const effectiveProviderId = resolveProvider(role.key, settings, globalConfig)
          const isGeneration = role.key === 'generation'

          return (
            <div key={role.key} className="px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="min-w-0">
                  <p className="text-[0.75rem] font-medium text-foreground/80">{role.label}</p>
                  <p className="text-[0.625rem] text-muted-foreground leading-snug">{role.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <ProviderSelect
                    value={directProviderId}
                    globalConfig={globalConfig}
                    onChange={(id) => {
                      updateMutation.mutate({
                        modelOverrides: { ...overrides, [role.key]: { providerId: id, modelId: null, temperature: null } },
                      })
                    }}
                    disabled={updateMutation.isPending}
                    inheritLabel={isGeneration ? undefined : getInheritLabel(role.key, roles, settings, globalConfig)}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <ModelSelect
                    providerId={effectiveProviderId}
                    value={directModelId}
                    onChange={(mid) => {
                      const current = overrides[role.key] ?? {}
                      updateMutation.mutate({
                        modelOverrides: {
                          ...overrides,
                          [role.key]: {
                            ...current,
                            providerId: mid ? (current.providerId ?? effectiveProviderId) : current.providerId,
                            modelId: mid,
                          },
                        },
                      })
                    }}
                    disabled={updateMutation.isPending}
                    defaultLabel={isGeneration ? 'Default' : 'Inherit'}
                  />
                </div>
                <div className="shrink-0 w-16">
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={overrides[role.key]?.temperature ?? ''}
                    onChange={(e) => {
                      const val = e.target.value
                      const temp = val === '' ? null : parseFloat(val)
                      const current = overrides[role.key] ?? {}
                      updateMutation.mutate({
                        modelOverrides: { ...overrides, [role.key]: { ...current, temperature: temp } },
                      })
                    }}
                    disabled={updateMutation.isPending}
                    placeholder="Temp"
                    title="Temperature (0–2). Leave empty to use provider default."
                    className="w-full h-[26px] px-1.5 text-[0.6875rem] font-mono text-center bg-background border border-border/40 rounded-md focus:border-foreground/20 focus:outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
              </div>
            </div>
          )
        })}
        <button
          type="button"
          onClick={onManageProviders}
          className="w-full flex items-center justify-between px-3 py-2 text-[0.6875rem] text-muted-foreground hover:text-foreground/60 hover:bg-accent/20 transition-colors rounded-b-lg"
          data-component-id="settings-manage-providers"
        >
          <span className="flex items-center gap-1.5">
            <Settings2 className="size-3" />
            Manage providers
          </span>
          <ChevronRight className="size-3" />
        </button>
      </div>
    </div>
  )
}

const DEFAULT_CONTINUE = 'Continue the story naturally. Write the next scene, advancing the plot and developing characters.'
const DEFAULT_SCENE_SETTING = "Continue the story without advancing the plot. Focus on atmosphere, internal thoughts, sensory details, or character moments. Don't introduce new events or move the story forward."
const DEFAULT_SUGGEST = `Based on everything in the story so far, suggest exactly {{count}} possible directions the story could go next. Return ONLY a JSON array with no other text. Each element must have:
- "title": a short evocative title (3-6 words)
- "description": 1-2 sentences describing this direction
- "instruction": a detailed writing prompt (2-3 sentences) that could be given to a writer to produce this continuation

Consider a mix of: advancing the main plot, exploring character relationships, introducing tension or conflict, quiet character moments, and unexpected developments. Make each suggestion meaningfully different from the others.

Respond with ONLY the JSON array, no markdown fences or other text.`

function GuidedPromptsControls({ story, onUpdate, isPending }: {
  story: StoryMeta
  onUpdate: (data: { guidedContinuePrompt?: string; guidedSceneSettingPrompt?: string; guidedSuggestPrompt?: string }) => void
  isPending: boolean
}) {
  const [continuePrompt, setContinuePrompt] = useState(story.settings.guidedContinuePrompt ?? '')
  const [sceneSettingPrompt, setSceneSettingPrompt] = useState(story.settings.guidedSceneSettingPrompt ?? '')
  const [suggestPrompt, setSuggestPrompt] = useState(story.settings.guidedSuggestPrompt ?? '')

  const save = (field: string, value: string) => {
    onUpdate({ [field]: value || undefined })
  }

  return (
    <div className="space-y-4">
        <div>
          <label className="text-[0.6875rem] font-medium text-foreground/80 mb-1 block">Continue prompt</label>
          <p className="text-[0.625rem] text-muted-foreground mb-1.5 leading-snug">Used when clicking the "Continue" button</p>
          <textarea
            value={continuePrompt}
            onChange={(e) => setContinuePrompt(e.target.value)}
            onBlur={() => save('guidedContinuePrompt', continuePrompt)}
            placeholder={DEFAULT_CONTINUE}
            rows={3}
            disabled={isPending}
            className="w-full text-[0.75rem] bg-muted/30 border border-border/30 rounded-md px-2.5 py-2 resize-none outline-none focus:border-primary/30 transition-colors placeholder:text-muted-foreground/50 disabled:opacity-40"
          />
        </div>
        <div>
          <label className="text-[0.6875rem] font-medium text-foreground/80 mb-1 block">Scene-setting prompt</label>
          <p className="text-[0.625rem] text-muted-foreground mb-1.5 leading-snug">Used when clicking the "Scene-setting" button</p>
          <textarea
            value={sceneSettingPrompt}
            onChange={(e) => setSceneSettingPrompt(e.target.value)}
            onBlur={() => save('guidedSceneSettingPrompt', sceneSettingPrompt)}
            placeholder={DEFAULT_SCENE_SETTING}
            rows={3}
            disabled={isPending}
            className="w-full text-[0.75rem] bg-muted/30 border border-border/30 rounded-md px-2.5 py-2 resize-none outline-none focus:border-primary/30 transition-colors placeholder:text-muted-foreground/50 disabled:opacity-40"
          />
        </div>
        <div>
          <label className="text-[0.6875rem] font-medium text-foreground/80 mb-1 block">Suggest directions prompt</label>
          <p className="text-[0.625rem] text-muted-foreground mb-1.5 leading-snug">
            Prompt for generating direction suggestions. Use <code className="text-[0.625rem] bg-muted/50 px-1 rounded">{'{{count}}'}</code> for the number of suggestions.
          </p>
          <textarea
            value={suggestPrompt}
            onChange={(e) => setSuggestPrompt(e.target.value)}
            onBlur={() => save('guidedSuggestPrompt', suggestPrompt)}
            placeholder={DEFAULT_SUGGEST}
            rows={6}
            disabled={isPending}
            className="w-full text-[0.75rem] bg-muted/30 border border-border/30 rounded-md px-2.5 py-2 resize-none outline-none focus:border-primary/30 transition-colors placeholder:text-muted-foreground/50 disabled:opacity-40"
          />
        </div>
        <p className="text-[0.625rem] text-muted-foreground italic">
          Leave empty to use the default prompt. Changes are saved when you leave each field.
        </p>
    </div>
  )
}

export function SettingsPanel({
  storyId,
  story,
  onManageProviders,
  onOpenPluginPanel,
  onTogglePluginSidebar,
  pluginSidebarVisibility,
}: SettingsPanelProps) {
  const queryClient = useQueryClient()

  const { data: plugins } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.plugins.list(),
  })

  const { data: globalConfig } = useQuery({
    queryKey: ['global-config'],
    queryFn: () => api.config.getProviders(),
  })

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.settings.update>[1]) =>
      api.settings.update(storyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
    },
  })

  const togglePlugin = (pluginName: string) => {
    const enabled = story.settings.enabledPlugins
    const next = enabled.includes(pluginName)
      ? enabled.filter((p) => p !== pluginName)
      : [...enabled, pluginName]
    updateMutation.mutate({ enabledPlugins: next })
  }

  const [customCssPanelOpen, setCustomCssPanelOpen] = useState(false)
  const [writingTransforms] = useWritingTransforms()
  const enabledTransformCount = writingTransforms.filter(t => t.enabled).length
  const [transformContext, setTransformContext] = useTransformContext()
  const { openHelp } = useHelp()
  const { theme, setTheme } = useTheme()
  const [quickSwitch, setQuickSwitch] = useQuickSwitch()
  const [characterMentions, setCharacterMentions] = useCharacterMentions()
  const [timelineBar, setTimelineBar] = useTimelineBar()
  const [proseWidth, setProseWidth] = useProseWidth()
  const [uiFontSize, setUiFontSize] = useUiFontSize()
  const [proseFontSize, setProseFontSize] = useProseFontSize()
  const [fontPrefs, setFont, resetFonts] = useFontPreferences()
  const hasCustomFonts = Object.keys(fontPrefs).length > 0
  const [, customCssEnabled, , setCustomCssEnabled] = useCustomCss()

  const summaryCompact = story.settings.summaryCompact ?? { maxCharacters: 12000, targetCharacters: 9000 }

  if (customCssPanelOpen) {
    return <CustomCssPanel onClose={() => setCustomCssPanelOpen(false)} />
  }

  return (
    <div className="p-4 space-y-4" data-component-id="settings-panel-root">
      {/* Appearance */}
      <SettingsSection id="set-appearance" label="Appearance" group="Interface">
        <SectionHeading label="Appearance" />
        <SettingsCard>
          <SettingRow label="Theme">
            <SegmentedControl
              value={theme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'high-contrast', label: 'High' },
              ]}
              onChange={setTheme}
            />
          </SettingRow>
          <SettingRow label="UI size" description="Scale the entire interface">
            <SegmentedControl<UiFontSize>
              value={uiFontSize}
              options={[
                { value: 'xs', label: UI_FONT_SIZE_LABELS.xs },
                { value: 'sm', label: UI_FONT_SIZE_LABELS.sm },
                { value: 'md', label: UI_FONT_SIZE_LABELS.md },
                { value: 'lg', label: UI_FONT_SIZE_LABELS.lg },
                { value: 'xl', label: UI_FONT_SIZE_LABELS.xl },
              ]}
              onChange={setUiFontSize}
            />
          </SettingRow>
          <SettingRow label="Quick switch" description="Show chevrons to swap between variations">
            <Toggle checked={quickSwitch} onChange={setQuickSwitch} label="Toggle quick switch" />
          </SettingRow>
          <SettingRow label="Character mentions" description="Highlight character names in prose">
            <Toggle checked={characterMentions} onChange={setCharacterMentions} label="Toggle character mentions" />
          </SettingRow>
          <SettingRow label="Timeline bar" description="Show timeline switcher above prose">
            <Toggle checked={timelineBar} onChange={setTimelineBar} label="Toggle timeline bar" />
          </SettingRow>
          <SettingRow label="Prose width" description="Reading column width">
            <SegmentedControl<ProseWidth>
              value={proseWidth}
              options={[
                { value: 'narrow', label: 'Narrow' },
                { value: 'medium', label: 'Medium' },
                { value: 'wide', label: 'Wide' },
                { value: 'full', label: 'Full' },
              ]}
              onChange={setProseWidth}
            />
          </SettingRow>
          <SettingRow label="Font size" description="Prose text size">
            <SegmentedControl<ProseFontSize>
              value={proseFontSize}
              options={[
                { value: 'xs', label: PROSE_FONT_SIZE_LABELS.xs },
                { value: 'sm', label: PROSE_FONT_SIZE_LABELS.sm },
                { value: 'md', label: PROSE_FONT_SIZE_LABELS.md },
                { value: 'lg', label: PROSE_FONT_SIZE_LABELS.lg },
                { value: 'xl', label: PROSE_FONT_SIZE_LABELS.xl },
              ]}
              onChange={setProseFontSize}
            />
          </SettingRow>
          <SettingRow label="Custom CSS" description="Apply your own styles globally">
            <Toggle checked={customCssEnabled} onChange={setCustomCssEnabled} label="Toggle custom CSS" />
          </SettingRow>
          {customCssEnabled && (
            <button
              type="button"
              onClick={() => setCustomCssPanelOpen(true)}
              className="w-full flex items-center justify-between px-3 py-2 text-[0.6875rem] text-muted-foreground hover:text-foreground/60 hover:bg-accent/20 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Code className="size-3" />
                Edit custom CSS
              </span>
              <ChevronRight className="size-3" />
            </button>
          )}
        </SettingsCard>
        <ProseColorsControls />
      </SettingsSection>

      {/* Typography */}
      <SettingsSection id="set-typography" label="Typography" group="Interface">
        <SectionHeading
          label="Typography"
          action={hasCustomFonts && (
            <button
              onClick={resetFonts}
              className="flex items-center gap-1 text-[0.625rem] text-muted-foreground hover:text-foreground/60 transition-colors"
            >
              <RotateCcw className="size-2.5" />
              Reset
            </button>
          )}
        />
        <SettingsCard>
          <FontPicker
            role="display"
            label="Display"
            description="Titles, headings, story names"
            activeFont={getActiveFont('display', fontPrefs)}
            onSelect={(name) => setFont('display', name)}
          />
          <FontPicker
            role="prose"
            label="Prose"
            description="Reading experience, story content"
            activeFont={getActiveFont('prose', fontPrefs)}
            onSelect={(name) => setFont('prose', name)}
          />
          <FontPicker
            role="sans"
            label="Interface"
            description="UI text, buttons, labels"
            activeFont={getActiveFont('sans', fontPrefs)}
            onSelect={(name) => setFont('sans', name)}
          />
          <FontPicker
            role="mono"
            label="Code"
            description="Fragment IDs, monospace text"
            activeFont={getActiveFont('mono', fontPrefs)}
            onSelect={(name) => setFont('mono', name)}
          />
        </SettingsCard>
      </SettingsSection>

      {/* Read aloud (TTS) */}
      <SettingsSection id="set-read-aloud" label="Read aloud" group="Interface"><TtsSettings /></SettingsSection>

      {/* LLM */}
      <SettingsSection id="set-providers" label="Providers" group="Writing">
        <LLMSection
          story={story}
          globalConfig={globalConfig ?? null}
          updateMutation={updateMutation}
          onManageProviders={onManageProviders}
        />
      </SettingsSection>

      {/* Generation */}
      <SettingsSection id="set-generation" label="Generation" group="Writing">
        <SectionHeading label="Generation" helpTopic="generation#overview" />
        <div className="space-y-3">
          <SettingsGroup title="Workflow" description="How prose generation runs and what the model is allowed to do.">
            <SettingRow label="Generation mode" description="How prose generation is handled">
              <SegmentedControl
                value={(story.settings.generationMode ?? 'standard') as 'standard' | 'prewriter'}
                options={[
                  { value: 'standard' as const, label: 'Standard' },
                  { value: 'prewriter' as const, label: 'Prewriter' },
                ]}
                onChange={(v) => updateMutation.mutate({ generationMode: v })}
                disabled={updateMutation.isPending}
              />
            </SettingRow>
            {(story.settings.generationMode ?? 'standard') === 'prewriter' && (
              <>
                <SettingRow label="Prewriter reasoning" description="How much the prewriter deliberates. Short favors speed; Extensive favors depth.">
                  <SegmentedControl
                    value={(story.settings.prewriterReasoning ?? 'normal') as 'short' | 'normal' | 'extensive'}
                    options={[
                      { value: 'short' as const, label: 'Short' },
                      { value: 'normal' as const, label: 'Normal' },
                      { value: 'extensive' as const, label: 'Extensive' },
                    ]}
                    onChange={(v) => updateMutation.mutate({ prewriterReasoning: v })}
                    disabled={updateMutation.isPending}
                  />
                </SettingRow>
                <SettingRow label="Clarify before writing" description="Let the prewriter ask you questions when your direction is ambiguous, before it writes.">
                  <Toggle
                    checked={story.settings.clarifyBeforeGenerate ?? false}
                    onChange={(next) => updateMutation.mutate({ clarifyBeforeGenerate: next })}
                    disabled={updateMutation.isPending}
                    label="Toggle clarify before writing"
                  />
                </SettingRow>
              </>
            )}
            <SettingRow label="Output format" helpTopic="generation#output-format">
              <SegmentedControl
                value={story.settings.outputFormat}
                options={[
                  { value: 'plaintext', label: 'Plain' },
                  { value: 'markdown', label: 'Markdown' },
                ]}
                onChange={(v) => updateMutation.mutate({ outputFormat: v })}
                disabled={updateMutation.isPending}
              />
            </SettingRow>
            <SettingRow label="Max steps" description="Tool-use rounds per generation" helpTopic="generation#max-steps">
              <NumberField
                value={story.settings.maxSteps ?? 10}
                min={1}
                max={50}
                onChange={(v) => updateMutation.mutate({ maxSteps: v })}
                disabled={updateMutation.isPending}
              />
            </SettingRow>
            <SettingRow label="Disable thinking" description="Suppress extended thinking / reasoning mode on models that support it">
              <Toggle
                checked={story.settings.disableThinking ?? false}
                onChange={(next) => updateMutation.mutate({ disableThinking: next })}
                disabled={updateMutation.isPending}
                label="Toggle disable thinking"
              />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title="Context" description="How the prompt is assembled before generation starts.">
            <SettingRow label="Fragment ordering" description="Grouped bundles fragments by type. Custom unlocks the Fragment Order panel for drag-and-drop sequencing." helpTopic="settings#prompt-control">
              <SegmentedControl
                value={story.settings.contextOrderMode ?? 'simple'}
                options={[
                  { value: 'simple', label: 'Grouped' },
                  { value: 'advanced', label: 'Custom' },
                ]}
                onChange={(v) => updateMutation.mutate({ contextOrderMode: v })}
                disabled={updateMutation.isPending}
              />
            </SettingRow>
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-1">
                <p className="text-[0.75rem] font-medium text-foreground/80">Context limit</p>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openHelp('generation#context-limit') }}
                  className="text-muted-foreground hover:text-primary/60 transition-colors"
                  title="Learn more"
                >
                  <CircleHelp className="size-3" />
                </button>
              </div>
              <p className="text-[0.625rem] text-muted-foreground mt-0.5 leading-snug">How much recent prose to include</p>
              <div className="flex items-center justify-between gap-2 mt-2.5">
                <SegmentedControl
                  value={(story.settings.contextCompact?.type ?? 'proseLimit') as 'proseLimit' | 'maxTokens' | 'maxCharacters'}
                  options={[
                    { value: 'proseLimit' as const, label: 'Fragments' },
                    { value: 'maxTokens' as const, label: 'Tokens' },
                    { value: 'maxCharacters' as const, label: 'Characters' },
                  ]}
                  onChange={(v) => {
                    const defaults = { proseLimit: 10, maxTokens: 40000, maxCharacters: 160000 } as const
                    updateMutation.mutate({ contextCompact: { type: v, value: defaults[v] } })
                  }}
                  disabled={updateMutation.isPending}
                />
                <NumberField
                  value={story.settings.contextCompact?.value ?? 10}
                  min={(story.settings.contextCompact?.type ?? 'proseLimit') === 'proseLimit' ? 1 : (story.settings.contextCompact?.type ?? 'proseLimit') === 'maxTokens' ? 100 : 500}
                  max={(story.settings.contextCompact?.type ?? 'proseLimit') === 'proseLimit' ? 100 : (story.settings.contextCompact?.type ?? 'proseLimit') === 'maxTokens' ? 100000 : 500000}
                  onChange={(v) => updateMutation.mutate({ contextCompact: { type: story.settings.contextCompact?.type ?? 'proseLimit', value: v } })}
                  disabled={updateMutation.isPending}
                  className={(story.settings.contextCompact?.type ?? 'proseLimit') !== 'proseLimit' ? 'w-20' : undefined}
                />
              </div>
            </div>
          </SettingsGroup>

          <SettingsGroup title="Memory" description="How story state is summarized and carried forward over time.">
            <SettingRow label="Summarization" description="Positions back before summarizing" helpTopic="generation#summarization">
              <NumberField
                value={story.settings.summarizationThreshold ?? 4}
                min={0}
                max={20}
                onChange={(v) => updateMutation.mutate({ summarizationThreshold: v })}
                disabled={updateMutation.isPending}
              />
            </SettingRow>
            <div className="px-3 py-2.5">
              <p className="text-[0.75rem] font-medium text-foreground/80">Summary compaction</p>
              <p className="text-[0.625rem] text-muted-foreground mt-0.5 leading-snug">Keeps rolling summary bounded as stories grow</p>

              <div className="mt-2.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.6875rem] text-muted-foreground">Max characters</span>
                  <NumberField
                    value={summaryCompact.maxCharacters}
                    min={100}
                    max={100000}
                    onChange={(v) => {
                      const nextMax = Math.max(100, v)
                      updateMutation.mutate({
                        summaryCompact: {
                          maxCharacters: nextMax,
                          targetCharacters: Math.min(summaryCompact.targetCharacters, nextMax),
                        },
                      })
                    }}
                    disabled={updateMutation.isPending}
                    className="w-20"
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.6875rem] text-muted-foreground">Target characters</span>
                  <NumberField
                    value={summaryCompact.targetCharacters}
                    min={100}
                    max={summaryCompact.maxCharacters}
                    onChange={(v) => {
                      updateMutation.mutate({
                        summaryCompact: {
                          maxCharacters: summaryCompact.maxCharacters,
                          targetCharacters: Math.min(Math.max(100, v), summaryCompact.maxCharacters),
                        },
                      })
                    }}
                    disabled={updateMutation.isPending}
                    className="w-20"
                  />
                </div>
              </div>
            </div>
            <SettingRow
              label="Hierarchical summaries"
              description="Include chapter marker summaries with rolling story summary"
              helpTopic="generation#hierarchical-summaries"
            >
              <Toggle
                checked={story.settings.enableHierarchicalSummary ?? false}
                onChange={(next) => updateMutation.mutate({ enableHierarchicalSummary: next })}
                disabled={updateMutation.isPending}
                label="Toggle hierarchical summaries"
              />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title="Librarian" description="What happens after prose is generated and the librarian follows up.">
            <SettingRow label="Disable auto analysis" description="Do not run the librarian automatically after prose generation">
              <Toggle
                checked={story.settings.disableLibrarianAutoAnalysis ?? false}
                onChange={(next) => updateMutation.mutate({ disableLibrarianAutoAnalysis: next })}
                disabled={updateMutation.isPending}
                label="Toggle disable auto analysis"
              />
            </SettingRow>
            <SettingRow label="Auto-apply suggestions" description="Librarian auto creates and updates suggested fragments" helpTopic="librarian#auto-suggestions">
              <Toggle
                checked={story.settings.autoApplyLibrarianSuggestions ?? false}
                onChange={(next) => updateMutation.mutate({ autoApplyLibrarianSuggestions: next })}
                disabled={updateMutation.isPending}
                label="Toggle auto-apply suggestions"
              />
            </SettingRow>
            <SettingRow label="Disable directions" description="Skip story direction suggestions during analysis">
              <Toggle
                checked={story.settings.disableLibrarianDirections ?? false}
                onChange={(next) => updateMutation.mutate({ disableLibrarianDirections: next })}
                disabled={updateMutation.isPending}
                label="Toggle disable directions"
              />
            </SettingRow>
            <SettingRow label="Disable suggestions" description="Skip fragment create/update suggestions during analysis">
              <Toggle
                checked={story.settings.disableLibrarianSuggestions ?? false}
                onChange={(next) => updateMutation.mutate({ disableLibrarianSuggestions: next })}
                disabled={updateMutation.isPending}
                label="Toggle disable suggestions"
              />
            </SettingRow>
          </SettingsGroup>
        </div>
      </SettingsSection>

      {/* Authoring (transforms + guided prompts) */}
      <SettingsSection id="set-authoring" label="Authoring" group="Writing">
        <SectionHeading label="Authoring" />
        <div className="space-y-6">
          <div className="space-y-2.5">
            <div>
              <p className="text-[0.625rem] uppercase tracking-[0.14em] text-muted-foreground">
                Selection transforms{enabledTransformCount > 0 ? ` · ${enabledTransformCount} active` : ''}
              </p>
              <p className="text-[0.6875rem] text-muted-foreground mt-0.5 leading-snug">
                Quick rewrites in the floating toolbar when you select text. Drag to reorder, toggle to show or hide.
              </p>
            </div>
            <SettingsCard>
              <SettingRow label="Surrounding context" description="How much of the passage around your selection a transform can read.">
                <SegmentedControl
                  value={transformContext}
                  options={(['tight', 'wide', 'passage'] as TransformContext[]).map((v) => ({ value: v, label: TRANSFORM_CONTEXT_LABELS[v] }))}
                  onChange={setTransformContext}
                />
              </SettingRow>
            </SettingsCard>
            <CustomTransformsControls />
          </div>

          <div className="space-y-2.5">
            <div>
              <p className="text-[0.625rem] uppercase tracking-[0.14em] text-muted-foreground">Guided mode prompts</p>
              <p className="text-[0.6875rem] text-muted-foreground mt-0.5 leading-snug">
                The prompts behind the guided writing buttons. Leave a field empty to use its default.
              </p>
            </div>
            <GuidedPromptsControls story={story} onUpdate={(data) => updateMutation.mutate(data)} isPending={updateMutation.isPending} />
          </div>
        </div>
      </SettingsSection>

      {/* Remote access (auth + LAN + tunnel) */}
      <SettingsSection id="set-remote" label="Remote" group="System"><SharingPanel /></SettingsSection>

      {/* Plugins */}
      <SettingsSection id="set-plugins" label="Plugins" group="System">
        <SectionHeading label="Plugins" helpTopic="settings#plugins" className="mb-3" />
        {plugins && plugins.length > 0 ? (
          <div className="space-y-2">
            {plugins.map((plugin) => {
              const isEnabled = story.settings.enabledPlugins.includes(plugin.name)
              const isSidebarVisible = (pluginSidebarVisibility?.[plugin.name]) ?? (plugin.panel?.showInSidebar !== false)
              return (
                <div
                  key={plugin.name}
                  className={`rounded-lg border transition-colors ${isEnabled
                      ? 'border-border/60 bg-accent/20'
                      : 'border-border/30 bg-transparent'
                    }`}
                >
                  {/* Main row: toggle + info */}
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <button
                      onClick={() => togglePlugin(plugin.name)}
                      disabled={updateMutation.isPending}
                      className={`mt-0.5 relative shrink-0 h-[18px] w-[32px] rounded-full transition-colors ${isEnabled
                          ? 'bg-foreground'
                          : 'bg-muted-foreground/20'
                        }`}
                      aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                    >
                      <span
                        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-background transition-[left] duration-150 ${isEnabled ? 'left-[16px]' : 'left-[2px]'
                          }`}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.8125rem] font-medium leading-tight text-foreground/85">{plugin.name}</p>
                      <p className="text-[0.6875rem] text-muted-foreground mt-0.5 leading-snug">{plugin.description}</p>
                    </div>
                    <span className={`text-[0.5625rem] uppercase tracking-widest mt-1 shrink-0 ${isEnabled ? 'text-foreground/50' : 'text-muted-foreground'
                      }`}>
                      v{plugin.version}
                    </span>
                  </div>

                  {/* Panel actions — only when enabled and has a panel */}
                  {isEnabled && plugin.panel && (
                    <div className="flex items-center gap-1 px-3 pb-2.5 pt-0">
                      {onOpenPluginPanel && (
                        <button
                          onClick={() => onOpenPluginPanel(plugin.name)}
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.6875rem] text-muted-foreground hover:text-foreground/70 hover:bg-accent/40 transition-colors"
                        >
                          <ExternalLink className="size-3" />
                          Open panel
                        </button>
                      )}
                      {onTogglePluginSidebar && (
                        <button
                          onClick={() => onTogglePluginSidebar(plugin.name, !isSidebarVisible)}
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.6875rem] text-muted-foreground hover:text-foreground/70 hover:bg-accent/40 transition-colors"
                        >
                          {isSidebarVisible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                          {isSidebarVisible ? 'Visible in sidebar' : 'Hidden from sidebar'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <Puzzle className="size-5 text-muted-foreground mb-2" />
            <p className="text-[0.6875rem] text-muted-foreground">No plugins available</p>
          </div>
        )}
      </SettingsSection>

      {/* Desktop app + updates (Electron only; renders nothing in the browser) */}
      <DesktopUpdatesControls />

      {/* Attribution */}
      <div className="pt-4 mt-2 border-t border-border/20">
        <p className="text-[0.625rem] text-muted-foreground text-center leading-relaxed">
          Errata v{__BUILD_VERSION__}
          <br />
          Built by{' '}
          <a
            href="https://github.com/tealios"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-muted-foreground transition-colors"
          >
            Tealios
          </a>
        </p>
      </div>
    </div>
  )
}
