import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta, type GlobalConfigSafe } from '@/lib/api'
import { useTheme, useQuickSwitch } from '@/lib/theme'
import { RefreshCw, Loader2, Settings2, ChevronRight, ExternalLink, Eye, EyeOff, Puzzle } from 'lucide-react'
import { useModelFetcher } from '@/components/settings/ProviderManager'

interface SettingsPanelProps {
  storyId: string
  story: StoryMeta
  onManageProviders: () => void
  onOpenPluginPanel?: (pluginName: string) => void
  onTogglePluginSidebar?: (pluginName: string, visible: boolean) => void
  pluginSidebarVisibility?: Record<string, boolean>
}

type SettingsMutation = ReturnType<typeof useMutation<StoryMeta, Error, { enabledPlugins?: string[]; outputFormat?: 'plaintext' | 'markdown'; summarizationThreshold?: number; maxSteps?: number; providerId?: string | null; modelId?: string | null; contextOrderMode?: 'simple' | 'advanced'; fragmentOrder?: string[] }>>

function ToggleSwitch({ on, onToggle, disabled, label }: { on: boolean; onToggle: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative shrink-0 h-[18px] w-[32px] rounded-full transition-colors ${
        on ? 'bg-foreground' : 'bg-muted-foreground/20'
      }`}
      aria-label={label}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-background transition-[left] duration-150 ${
          on ? 'left-[16px]' : 'left-[2px]'
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
          className={`px-2.5 text-[11px] font-medium transition-colors ${
            value === opt.value
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

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-foreground/80">{label}</p>
        {description && <p className="text-[10px] text-muted-foreground/40 mt-0.5 leading-snug">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function NumberStepper({ value, min, max, onChange, disabled, suffix }: {
  value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean; suffix?: string
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
        className="w-14 h-[26px] px-2 text-[11px] font-mono text-center bg-background border border-border/40 rounded-md focus:border-foreground/20 focus:outline-none"
        disabled={disabled}
      />
      {suffix && <span className="text-[10px] text-muted-foreground/35">{suffix}</span>}
    </div>
  )
}

function ModelSelector({ story, globalConfig, updateMutation, onManageProviders }: {
  story: StoryMeta
  globalConfig: GlobalConfigSafe | null
  updateMutation: SettingsMutation
  onManageProviders: () => void
}) {
  const { models, fetching, error, fetchModels, reset } = useModelFetcher()
  const [useCustomModel, setUseCustomModel] = useState(false)

  const effectiveProviderId = story.settings.providerId ?? globalConfig?.defaultProviderId ?? null

  const handleProviderChange = (value: string) => {
    const providerId = value || null
    updateMutation.mutate({ providerId, modelId: null })
    reset()
    setUseCustomModel(false)
  }

  const handleFetchModels = () => {
    if (effectiveProviderId) fetchModels(effectiveProviderId)
  }

  const defaultModel = story.settings.providerId
    ? globalConfig?.providers.find(p => p.id === story.settings.providerId)?.defaultModel ?? ''
    : globalConfig?.defaultProviderId
      ? globalConfig.providers.find(p => p.id === globalConfig.defaultProviderId)?.defaultModel ?? ''
      : 'deepseek-chat'

  const inputClass = "w-full h-[26px] px-2 text-[11px] bg-background border border-border/40 rounded-md focus:border-foreground/20 focus:outline-none"

  return (
    <div className="rounded-lg border border-border/30">
      <div className="px-3 py-2 space-y-2">
        {/* Provider */}
        <div>
          <label className="text-[10px] text-muted-foreground/40 mb-1 block">Provider</label>
          <select
            value={story.settings.providerId ?? ''}
            onChange={(e) => handleProviderChange(e.target.value)}
            className={inputClass}
            disabled={updateMutation.isPending}
          >
            <option value="">
              {globalConfig?.defaultProviderId
                ? `${globalConfig.providers.find(p => p.id === globalConfig.defaultProviderId)?.name ?? 'Default'}`
                : 'DeepSeek (env)'}
            </option>
            {(globalConfig?.providers ?? []).filter(p => p.id !== globalConfig?.defaultProviderId).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="text-[10px] text-muted-foreground/40 mb-1 block">Model</label>
          <div className="flex gap-1.5">
            {models.length > 0 && !useCustomModel ? (
              <select
                value={story.settings.modelId ?? ''}
                onChange={(e) => updateMutation.mutate({ modelId: e.target.value || null })}
                className={inputClass + ' flex-1'}
                disabled={updateMutation.isPending}
              >
                <option value="">{defaultModel || 'default model'}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={story.settings.modelId ?? ''}
                onChange={(e) => updateMutation.mutate({ modelId: e.target.value || null })}
                placeholder={defaultModel || 'model id'}
                className={inputClass + ' flex-1'}
                disabled={updateMutation.isPending}
              />
            )}
            {effectiveProviderId && (
              <button
                onClick={handleFetchModels}
                disabled={fetching}
                className="h-[26px] w-[26px] shrink-0 flex items-center justify-center rounded-md border border-border/40 text-muted-foreground/50 hover:text-foreground/70 hover:bg-accent/30 transition-colors"
                title="Fetch available models"
              >
                {fetching ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              </button>
            )}
          </div>
          {models.length > 0 && (
            <button
              type="button"
              className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground mt-1.5 underline underline-offset-2"
              onClick={() => setUseCustomModel(!useCustomModel)}
            >
              {useCustomModel ? 'Use fetched models' : 'Type manually'}
            </button>
          )}
          {error && <p className="text-[10px] text-destructive mt-1">{error}</p>}
        </div>
      </div>

      {/* Manage providers link */}
      <button
        type="button"
        onClick={onManageProviders}
        className="w-full flex items-center justify-between px-3 py-2 border-t border-border/20 text-[11px] text-muted-foreground/40 hover:text-foreground/60 hover:bg-accent/20 transition-colors rounded-b-lg"
      >
        <span className="flex items-center gap-1.5">
          <Settings2 className="size-3" />
          Manage providers
        </span>
        <ChevronRight className="size-3" />
      </button>
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
    mutationFn: (data: { enabledPlugins?: string[]; outputFormat?: 'plaintext' | 'markdown'; summarizationThreshold?: number; maxSteps?: number; providerId?: string | null; modelId?: string | null; contextOrderMode?: 'simple' | 'advanced'; fragmentOrder?: string[] }) =>
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

  const { theme, setTheme } = useTheme()
  const [quickSwitch, setQuickSwitch] = useQuickSwitch()

  return (
    <div className="p-4 space-y-4">
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
              ]}
              onChange={setTheme}
            />
          </SettingRow>
          <SettingRow label="Quick switch" description="Show chevrons to swap between variations">
            <ToggleSwitch on={quickSwitch} onToggle={() => setQuickSwitch(!quickSwitch)} label="Toggle quick switch" />
          </SettingRow>
        </div>
      </div>

      {/* Generation */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">Generation</label>
        <div className="rounded-lg border border-border/30 divide-y divide-border/20">
          <SettingRow label="Output format">
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
          <SettingRow label="Context ordering" description="How pinned fragments are ordered">
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
          <SettingRow label="Summarization" description="Positions back before summarizing">
            <NumberStepper
              value={story.settings.summarizationThreshold ?? 4}
              min={0}
              max={20}
              onChange={(v) => updateMutation.mutate({ summarizationThreshold: v })}
              disabled={updateMutation.isPending}
            />
          </SettingRow>
          <SettingRow label="Max steps" description="Tool-use rounds per generation">
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

      {/* LLM */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">LLM</label>
        <ModelSelector
          story={story}
          globalConfig={globalConfig ?? null}
          updateMutation={updateMutation}
          onManageProviders={onManageProviders}
        />
      </div>

      {/* Plugins */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-3 block">Plugins</label>
        {plugins && plugins.length > 0 ? (
          <div className="space-y-2">
            {plugins.map((plugin) => {
              const isEnabled = story.settings.enabledPlugins.includes(plugin.name)
              const isSidebarVisible = (pluginSidebarVisibility?.[plugin.name]) ?? (plugin.panel?.showInSidebar !== false)
              return (
                <div
                  key={plugin.name}
                  className={`rounded-lg border transition-colors ${
                    isEnabled
                      ? 'border-border/60 bg-accent/20'
                      : 'border-border/30 bg-transparent'
                  }`}
                >
                  {/* Main row: toggle + info */}
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <button
                      onClick={() => togglePlugin(plugin.name)}
                      disabled={updateMutation.isPending}
                      className={`mt-0.5 relative shrink-0 h-[18px] w-[32px] rounded-full transition-colors ${
                        isEnabled
                          ? 'bg-foreground'
                          : 'bg-muted-foreground/20'
                      }`}
                      aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                    >
                      <span
                        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-background transition-[left] duration-150 ${
                          isEnabled ? 'left-[16px]' : 'left-[2px]'
                        }`}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-tight text-foreground/85">{plugin.name}</p>
                      <p className="text-[11px] text-muted-foreground/45 mt-0.5 leading-snug">{plugin.description}</p>
                    </div>
                    <span className={`text-[9px] uppercase tracking-widest mt-1 shrink-0 ${
                      isEnabled ? 'text-foreground/50' : 'text-muted-foreground/25'
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
