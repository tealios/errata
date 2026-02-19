import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta, type GlobalConfigSafe } from '@/lib/api'
import { useTheme, useQuickSwitch, useCharacterMentions, useTimelineBar, useProseWidth, useProseFontSize, PROSE_FONT_SIZE_LABELS, useFontPreferences, getActiveFont, FONT_CATALOGUE, useCustomCss, useWritingTransforms, type FontRole, type ProseWidth, type ProseFontSize } from '@/lib/theme'
import { Settings2, ChevronRight, ChevronDown, ExternalLink, Eye, EyeOff, Puzzle, Wrench, RotateCcw, CircleHelp, Code, Wand2 } from 'lucide-react'
import { useHelp } from '@/hooks/use-help'
import { CustomCssPanel } from '@/components/settings/CustomCssPanel'
import { CustomTransformsPanel } from '@/components/settings/CustomTransformsPanel'
import { ModelSelect } from '@/components/settings/ModelSelect'
import { MODEL_ROLES, roleSettingsKeys } from '@/lib/model-roles'

interface SettingsPanelProps {
  storyId: string
  story: StoryMeta
  onManageProviders: () => void
  onOpenPluginPanel?: (pluginName: string) => void
  onTogglePluginSidebar?: (pluginName: string, visible: boolean) => void
  pluginSidebarVisibility?: Record<string, boolean>
}


function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function pluralize(name: string): string {
  const massNouns = ['prose', 'knowledge']
  return massNouns.includes(name.toLowerCase()) ? name : `${name}s`
}

function ToggleSwitch({ on, onToggle, disabled, label }: { on: boolean; onToggle: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative shrink-0 h-[18px] w-[32px] rounded-full transition-colors ${on ? 'bg-foreground' : 'bg-muted-foreground/20'
        }`}
      aria-label={label}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-background transition-[left] duration-150 ${on ? 'left-[16px]' : 'left-[2px]'
          }`}
      />
    </button>
  )
}

function SegmentedControl<T extends string>({ value, options, onChange, disabled }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex h-[26px] rounded-md border border-border/40 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
          className={`px-2.5 text-[11px] font-medium transition-colors ${value === opt.value
              ? 'bg-foreground text-background'
              : 'bg-transparent text-muted-foreground/50 hover:text-foreground/70'
            }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function SettingRow({ label, description, helpTopic, children }: { label: string; description?: string; helpTopic?: string; children: React.ReactNode }) {
  const { openHelp } = useHelp()
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-[12px] font-medium text-foreground/80">{label}</p>
          {helpTopic && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openHelp(helpTopic) }}
              className="text-muted-foreground/25 hover:text-primary/60 transition-colors"
              title="Learn more"
            >
              <CircleHelp className="size-3" />
            </button>
          )}
        </div>
        {description && <p className="text-[10px] text-muted-foreground/40 mt-0.5 leading-snug">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function NumberStepper({ value, min, max, onChange, disabled, suffix, wide }: {
  value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean; suffix?: string; wide?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10)
          if (!isNaN(v) && v >= min && v <= max) onChange(v)
        }}
        className={`${wide ? 'w-20' : 'w-14'} h-[26px] px-2 text-[11px] font-mono text-center bg-background border border-border/40 rounded-md focus:border-foreground/20 focus:outline-none`}
        disabled={disabled}
      />
      {suffix && <span className="text-[10px] text-muted-foreground/35">{suffix}</span>}
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
  const options = FONT_CATALOGUE[role]
  return (
    <div className="px-3 py-2.5">
      <p className="text-[12px] font-medium text-foreground/80 mb-0.5">{label}</p>
      <p className="text-[10px] text-muted-foreground/40 mb-2 leading-snug">{description}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const isActive = opt.name === activeFont
          return (
            <button
              key={opt.name}
              onClick={() => onSelect(opt.name)}
              style={{ fontFamily: `"${opt.name}", ${opt.fallback}` }}
              className={`px-2.5 py-1 rounded-md text-[12px] border transition-all duration-150 ${isActive
                  ? 'border-foreground/25 bg-foreground/5 text-foreground shadow-[0_0_0_1px_var(--foreground)/5]'
                  : 'border-transparent text-muted-foreground/45 hover:text-foreground/70 hover:bg-accent/30'
                }`}
            >
              {opt.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ProviderSelect({ value, globalConfig, onChange, disabled, inheritLabel }: {
  value: string | null
  globalConfig: GlobalConfigSafe | null
  onChange: (providerId: string | null) => void
  disabled?: boolean
  inheritLabel?: string
}) {
  const defaultProvider = globalConfig?.defaultProviderId
    ? globalConfig.providers.find(p => p.id === globalConfig.defaultProviderId)
    : null

  const emptyLabel = inheritLabel
    ? inheritLabel
    : defaultProvider
      ? defaultProvider.name
      : 'DeepSeek (env)'

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full max-w-[140px] h-[26px] px-2 text-[11px] text-foreground/80 bg-muted/50 border border-border/50 rounded-md focus:border-primary/30 focus:outline-none truncate"
      disabled={disabled}
    >
      <option value="">
        {emptyLabel}
      </option>
      {(globalConfig?.providers ?? []).map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  )
}

/** Resolve the effective providerId for a role by walking the fallback chain */
function resolveProvider(
  roleKey: string,
  settings: StoryMeta['settings'],
  globalConfig: GlobalConfigSafe | null,
): string | null {
  const roleConfig = MODEL_ROLES.find(r => r.key === roleKey)
  if (!roleConfig) return null
  const chain = [roleKey, ...roleConfig.fallback]
  const s = settings as Record<string, unknown>
  for (const r of chain) {
    const keys = roleSettingsKeys(r)
    const pid = s[keys.providerId] as string | null | undefined
    if (pid) return pid
  }
  return globalConfig?.defaultProviderId ?? null
}

/** Get the inherit label for a role's provider dropdown (e.g. "Inherit (Librarian)") */
function getInheritLabel(
  roleKey: string,
  settings: StoryMeta['settings'],
  globalConfig: GlobalConfigSafe | null,
): string {
  const roleConfig = MODEL_ROLES.find(r => r.key === roleKey)
  if (!roleConfig) return 'Inherit'

  // Walk fallback chain to find which parent has a provider set
  for (const parentKey of roleConfig.fallback) {
    const s = settings as Record<string, unknown>
    const keys = roleSettingsKeys(parentKey)
    const pid = s[keys.providerId] as string | null | undefined
    if (pid) {
      const provider = globalConfig?.providers.find(p => p.id === pid)
      const parentRole = MODEL_ROLES.find(r => r.key === parentKey)
      return `Inherit${parentRole ? ` \u00b7 ${parentRole.label}` : ''}${provider ? ` (${provider.name})` : ''}`
    }
  }

  // Falls through to global default
  const defaultProvider = globalConfig?.defaultProviderId
    ? globalConfig.providers.find(p => p.id === globalConfig.defaultProviderId)
    : null
  return `Inherit${defaultProvider ? ` (${defaultProvider.name})` : ''}`
}

function LLMSection({ story, globalConfig, updateMutation, onManageProviders }: {
  story: StoryMeta
  globalConfig: GlobalConfigSafe | null
  updateMutation: { mutate: (data: Parameters<typeof api.settings.update>[1]) => void; isPending: boolean }
  onManageProviders: () => void
}) {
  const { openHelp } = useHelp()
  const settings = story.settings
  const s = settings as Record<string, unknown>

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">LLM</label>
        <button
          type="button"
          onClick={() => openHelp('settings#providers')}
          className="text-muted-foreground/25 hover:text-primary/60 transition-colors"
          title="About model configuration"
        >
          <CircleHelp className="size-3" />
        </button>
      </div>
      <div className="rounded-lg border border-border/30 divide-y divide-border/20">
        {MODEL_ROLES.map((role) => {
          const keys = roleSettingsKeys(role.key)
          const directProviderId = (s[keys.providerId] as string | null | undefined) ?? null
          const directModelId = (s[keys.modelId] as string | null | undefined) ?? null
          const effectiveProviderId = resolveProvider(role.key, settings, globalConfig)
          const isGeneration = role.key === 'generation'

          return (
            <div key={role.key} className="px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-foreground/80">{role.label}</p>
                  <p className="text-[10px] text-muted-foreground/40 leading-snug">{role.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <ProviderSelect
                    value={directProviderId}
                    globalConfig={globalConfig}
                    onChange={(id) => {
                      const update: Record<string, unknown> = { [keys.providerId]: id, [keys.modelId]: null }
                      updateMutation.mutate(update as Parameters<typeof api.settings.update>[1])
                    }}
                    disabled={updateMutation.isPending}
                    inheritLabel={isGeneration ? undefined : getInheritLabel(role.key, settings, globalConfig)}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <ModelSelect
                    providerId={effectiveProviderId}
                    value={directModelId}
                    onChange={(mid) => {
                      const update: Record<string, unknown> = { [keys.modelId]: mid }
                      updateMutation.mutate(update as Parameters<typeof api.settings.update>[1])
                    }}
                    disabled={updateMutation.isPending}
                    defaultLabel={isGeneration ? 'Default' : 'Inherit'}
                  />
                </div>
              </div>
            </div>
          )
        })}
        <button
          type="button"
          onClick={onManageProviders}
          className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground/40 hover:text-foreground/60 hover:bg-accent/20 transition-colors rounded-b-lg"
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

  const { data: fragmentTypes } = useQuery({
    queryKey: ['fragment-types', storyId],
    queryFn: () => api.fragments.types(storyId),
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

  const [toolsOpen, setToolsOpen] = useState(false)
  const [customCssPanelOpen, setCustomCssPanelOpen] = useState(false)
  const [transformsPanelOpen, setTransformsPanelOpen] = useState(false)
  const [writingTransforms] = useWritingTransforms()
  const enabledTransformCount = writingTransforms.filter(t => t.enabled).length
  const { openHelp } = useHelp()
  const { theme, setTheme } = useTheme()
  const [quickSwitch, setQuickSwitch] = useQuickSwitch()
  const [characterMentions, setCharacterMentions] = useCharacterMentions()
  const [timelineBar, setTimelineBar] = useTimelineBar()
  const [proseWidth, setProseWidth] = useProseWidth()
  const [proseFontSize, setProseFontSize] = useProseFontSize()
  const [fontPrefs, setFont, resetFonts] = useFontPreferences()
  const hasCustomFonts = Object.keys(fontPrefs).length > 0
  const [, customCssEnabled, , setCustomCssEnabled] = useCustomCss()
  const enabledBuiltinTools = story.settings.enabledBuiltinTools ?? []
  const builtinToolOptions = [
    { name: 'getFragment', description: 'Get full content for any fragment by ID.' },
    { name: 'listFragments', description: 'List fragments with id, type, name, description.' },
    { name: 'searchFragments', description: 'Search text across fragments.' },
    { name: 'listFragmentTypes', description: 'List all available fragment types.' },
    ...((fragmentTypes ?? []).map((type) => {
      const singular = capitalize(type.type)
      const plural = capitalize(pluralize(type.type))
      return [
        {
          name: `get${singular}`,
          description: `Get the full content of a ${type.type} fragment.`,
        },
        {
          name: `list${plural}`,
          description: `List all ${type.type} fragments.`,
        },
      ]
    }).flat()),
  ]

  const toggleBuiltinTool = (toolName: string) => {
    const next = enabledBuiltinTools.includes(toolName)
      ? enabledBuiltinTools.filter((name) => name !== toolName)
      : [...enabledBuiltinTools, toolName]
    updateMutation.mutate({ enabledBuiltinTools: next })
  }

  const summaryCompact = story.settings.summaryCompact ?? { maxCharacters: 12000, targetCharacters: 9000 }

  if (customCssPanelOpen) {
    return <CustomCssPanel onClose={() => setCustomCssPanelOpen(false)} />
  }

  if (transformsPanelOpen) {
    return <CustomTransformsPanel onClose={() => setTransformsPanelOpen(false)} />
  }

  return (
    <div className="p-4 space-y-4" data-component-id="settings-panel-root">
      {/* Appearance */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">Appearance</label>
        <div className="rounded-lg border border-border/30 divide-y divide-border/20">
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
          <SettingRow label="Quick switch" description="Show chevrons to swap between variations">
            <ToggleSwitch on={quickSwitch} onToggle={() => setQuickSwitch(!quickSwitch)} label="Toggle quick switch" />
          </SettingRow>
          <SettingRow label="Character mentions" description="Highlight character names in prose">
            <ToggleSwitch on={characterMentions} onToggle={() => setCharacterMentions(!characterMentions)} label="Toggle character mentions" />
          </SettingRow>
          <SettingRow label="Timeline bar" description="Show timeline switcher above prose">
            <ToggleSwitch on={timelineBar} onToggle={() => setTimelineBar(!timelineBar)} label="Toggle timeline bar" />
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
            <ToggleSwitch on={customCssEnabled} onToggle={() => setCustomCssEnabled(!customCssEnabled)} label="Toggle custom CSS" />
          </SettingRow>
          {customCssEnabled && (
            <button
              type="button"
              onClick={() => setCustomCssPanelOpen(true)}
              className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground/40 hover:text-foreground/60 hover:bg-accent/20 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Code className="size-3" />
                Edit custom CSS
              </span>
              <ChevronRight className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* Typography */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Typography</label>
          {hasCustomFonts && (
            <button
              onClick={resetFonts}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/30 hover:text-foreground/60 transition-colors"
            >
              <RotateCcw className="size-2.5" />
              Reset
            </button>
          )}
        </div>
        <div className="rounded-lg border border-border/30 divide-y divide-border/20">
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
        </div>
      </div>

      {/* Writing */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">Writing</label>
        <div className="rounded-lg border border-border/30 divide-y divide-border/20">
          <button
            type="button"
            onClick={() => setTransformsPanelOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent/20 transition-colors rounded-lg"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Wand2 className="size-3 text-muted-foreground/40" />
                <p className="text-[12px] font-medium text-foreground/80">Selection transforms</p>
              </div>
              <p className="text-[10px] text-muted-foreground/40 mt-0.5 leading-snug">
                {enabledTransformCount} custom transform{enabledTransformCount !== 1 ? 's' : ''} active
              </p>
            </div>
            <ChevronRight className="size-3.5 text-muted-foreground/40 shrink-0" />
          </button>
        </div>
      </div>

      {/* Generation */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Generation</label>
          <button
            type="button"
            onClick={() => openHelp('generation#overview')}
            className="text-muted-foreground/25 hover:text-primary/60 transition-colors"
            title="How generation works"
          >
            <CircleHelp className="size-3" />
          </button>
        </div>
        <div className="rounded-lg border border-border/30 divide-y divide-border/20">
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
          <SettingRow label="Prompt control" description="Advanced mode enables Block Editor and fragment ordering" helpTopic="settings#prompt-control">
            <SegmentedControl
              value={story.settings.contextOrderMode ?? 'simple'}
              options={[
                { value: 'simple', label: 'Simple' },
                { value: 'advanced', label: 'Advanced' },
              ]}
              onChange={(v) => updateMutation.mutate({ contextOrderMode: v })}
              disabled={updateMutation.isPending}
            />
          </SettingRow>
          <SettingRow label="Summarization" description="Positions back before summarizing" helpTopic="generation#summarization">
            <NumberStepper
              value={story.settings.summarizationThreshold ?? 4}
              min={0}
              max={20}
              onChange={(v) => updateMutation.mutate({ summarizationThreshold: v })}
              disabled={updateMutation.isPending}
            />
          </SettingRow>
          <div className="px-3 py-2.5 border-t border-border/20">
            <p className="text-[12px] font-medium text-foreground/80">Summary compaction</p>
            <p className="text-[10px] text-muted-foreground/40 mt-0.5 leading-snug">Keeps rolling summary bounded as stories grow</p>

            <div className="mt-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground/55">Max characters</span>
                <NumberStepper
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
                  wide
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground/55">Target characters</span>
                <NumberStepper
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
                  wide
                />
              </div>
            </div>
          </div>
          <SettingRow
            label="Hierarchical summaries"
            description="Include chapter marker summaries with rolling story summary"
            helpTopic="generation#hierarchical-summaries"
          >
            <ToggleSwitch
              on={story.settings.enableHierarchicalSummary ?? false}
              onToggle={() => updateMutation.mutate({ enableHierarchicalSummary: !(story.settings.enableHierarchicalSummary ?? false) })}
              disabled={updateMutation.isPending}
              label="Toggle hierarchical summaries"
            />
          </SettingRow>
          {/* Context limit — stacked layout for breathing room */}
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1">
              <p className="text-[12px] font-medium text-foreground/80">Context limit</p>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openHelp('generation#context-limit') }}
                className="text-muted-foreground/25 hover:text-primary/60 transition-colors"
                title="Learn more"
              >
                <CircleHelp className="size-3" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/40 mt-0.5 leading-snug">How much recent prose to include</p>
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
              <NumberStepper
                value={story.settings.contextCompact?.value ?? 10}
                min={(story.settings.contextCompact?.type ?? 'proseLimit') === 'proseLimit' ? 1 : (story.settings.contextCompact?.type ?? 'proseLimit') === 'maxTokens' ? 100 : 500}
                max={(story.settings.contextCompact?.type ?? 'proseLimit') === 'proseLimit' ? 100 : (story.settings.contextCompact?.type ?? 'proseLimit') === 'maxTokens' ? 100000 : 500000}
                onChange={(v) => updateMutation.mutate({ contextCompact: { type: story.settings.contextCompact?.type ?? 'proseLimit', value: v } })}
                disabled={updateMutation.isPending}
                wide={(story.settings.contextCompact?.type ?? 'proseLimit') !== 'proseLimit'}
              />
            </div>
          </div>
          <SettingRow label="Auto-apply suggestions" description="Librarian auto creates and updates suggested fragments" helpTopic="librarian#auto-suggestions">
            <ToggleSwitch
              on={story.settings.autoApplyLibrarianSuggestions ?? false}
              onToggle={() => updateMutation.mutate({ autoApplyLibrarianSuggestions: !(story.settings.autoApplyLibrarianSuggestions ?? false) })}
              disabled={updateMutation.isPending}
              label="Toggle auto-apply suggestions"
            />
          </SettingRow>
          <SettingRow label="Max steps" description="Tool-use rounds per generation" helpTopic="generation#max-steps">
            <NumberStepper
              value={story.settings.maxSteps ?? 10}
              min={1}
              max={50}
              onChange={(v) => updateMutation.mutate({ maxSteps: v })}
              disabled={updateMutation.isPending}
            />
          </SettingRow>
        </div>
      </div>

      {/* Built-in Tools — collapsible sub-panel */}
      <div>
          <button
            type="button"
            onClick={() => setToolsOpen(!toolsOpen)}
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-border/30 px-3 py-2.5 hover:bg-accent/20 transition-colors"
            data-component-id="settings-tools-toggle"
          >
          <div className="flex items-center gap-2 min-w-0">
            <Wrench className="size-3.5 text-muted-foreground/40 shrink-0" />
            <div className="text-left min-w-0">
              <p className="text-[12px] font-medium text-foreground/80">Built-in tools</p>
              <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                {enabledBuiltinTools.length} of {builtinToolOptions.length} enabled
              </p>
            </div>
          </div>
          <ChevronDown className={`size-3.5 text-muted-foreground/40 shrink-0 transition-transform duration-200 ${toolsOpen ? 'rotate-180' : ''}`} />
        </button>

        {toolsOpen && (
          <div className="mt-2 rounded-lg border border-border/30 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
            <div className="px-4 py-2.5 bg-muted/30 border-b border-border/20 space-y-1.5">
              <p className="text-[10.5px] text-muted-foreground/50 leading-snug">
                Tools let the model look up fragment details during generation. It can search, list, and read your characters, guidelines, and knowledge before writing.
                These are disabled by default — sticky fragments are already included in full, and non-sticky ones appear as shortlists the model can reference. Enable tools when you want the model to dynamically search or retrieve fragments on its own.
              </p>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openHelp('generation#built-in-tools') }}
                className="flex items-center gap-1 text-[10px] text-primary/60 hover:text-primary/90 transition-colors"
              >
                <CircleHelp className="size-2.5" />
                Learn more about tools
              </button>
            </div>
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-border/20">
              <p className="text-[10px] text-muted-foreground/40">Available during generation</p>
              <button
                type="button"
                className="text-[10px] text-muted-foreground/30 hover:text-foreground/60 transition-colors"
                onClick={() => updateMutation.mutate({ enabledBuiltinTools: [] })}
                disabled={updateMutation.isPending || enabledBuiltinTools.length === 0}
                data-component-id="settings-tools-disable-all"
              >
                Disable all
              </button>
            </div>
            <div className="divide-y divide-border/20">
              {builtinToolOptions.map((tool) => {
                const enabled = enabledBuiltinTools.includes(tool.name)
                return (
                  <div key={tool.name} className="flex items-start justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-mono text-foreground/70 truncate">{tool.name}</p>
                      <p className="text-[10px] text-muted-foreground/35 mt-0.5 leading-snug">{tool.description}</p>
                    </div>
                    <div className="shrink-0 mt-0.5">
                      <ToggleSwitch
                        on={enabled}
                        onToggle={() => toggleBuiltinTool(tool.name)}
                        disabled={updateMutation.isPending}
                        label={`Toggle ${tool.name}`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* LLM */}
      <LLMSection
        story={story}
        globalConfig={globalConfig ?? null}
        updateMutation={updateMutation}
        onManageProviders={onManageProviders}
      />

      {/* Plugins */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Plugins</label>
          <button
            type="button"
            onClick={() => openHelp('settings#plugins')}
            className="text-muted-foreground/25 hover:text-primary/60 transition-colors"
            title="About plugins"
          >
            <CircleHelp className="size-3" />
          </button>
        </div>
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
                      <p className="text-[13px] font-medium leading-tight text-foreground/85">{plugin.name}</p>
                      <p className="text-[11px] text-muted-foreground/45 mt-0.5 leading-snug">{plugin.description}</p>
                    </div>
                    <span className={`text-[9px] uppercase tracking-widest mt-1 shrink-0 ${isEnabled ? 'text-foreground/50' : 'text-muted-foreground/25'
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
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground/50 hover:text-foreground/70 hover:bg-accent/40 transition-colors"
                        >
                          <ExternalLink className="size-3" />
                          Open panel
                        </button>
                      )}
                      {onTogglePluginSidebar && (
                        <button
                          onClick={() => onTogglePluginSidebar(plugin.name, !isSidebarVisible)}
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground/50 hover:text-foreground/70 hover:bg-accent/40 transition-colors"
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
            <Puzzle className="size-5 text-muted-foreground/20 mb-2" />
            <p className="text-[11px] text-muted-foreground/35">No plugins available</p>
          </div>
        )}
      </div>

      {/* Attribution */}
      <div className="pt-4 mt-2 border-t border-border/20">
        <p className="text-[10px] text-muted-foreground/30 text-center leading-relaxed">
          Errata v{__BUILD_VERSION__}
          <br />
          Built by{' '}
          <a
            href="https://github.com/tealios"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-muted-foreground/50 transition-colors"
          >
            Tealios
          </a>
        </p>
      </div>
    </div>
  )
}
