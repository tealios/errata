import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta, type GlobalConfigSafe } from '@/lib/api'
import { useTheme, useQuickSwitch } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import { Sun, Moon, ChevronsLeftRight, RefreshCw, Loader2, Settings2, List, Shuffle } from 'lucide-react'
import { useModelFetcher } from '@/components/settings/ProviderManager'

interface SettingsPanelProps {
  storyId: string
  story: StoryMeta
  onManageProviders: () => void
}

function ModelSelector({ story, globalConfig, updateMutation, onManageProviders }: {
  story: StoryMeta
  globalConfig: GlobalConfigSafe | null
  updateMutation: ReturnType<typeof useMutation<StoryMeta, Error, { enabledPlugins?: string[]; outputFormat?: 'plaintext' | 'markdown'; summarizationThreshold?: number; maxSteps?: number; providerId?: string | null; modelId?: string | null; contextOrderMode?: 'simple' | 'advanced'; fragmentOrder?: string[] }>>
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
    if (effectiveProviderId) {
      fetchModels(effectiveProviderId)
    }
  }

  const defaultModel = story.settings.providerId
    ? globalConfig?.providers.find(p => p.id === story.settings.providerId)?.defaultModel ?? ''
    : globalConfig?.defaultProviderId
      ? globalConfig.providers.find(p => p.id === globalConfig.defaultProviderId)?.defaultModel ?? ''
      : 'deepseek-chat'

  const selectClass = "w-full h-7 px-2 text-xs bg-background border border-border/40 rounded-md focus:border-primary/30 focus:outline-none"

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">LLM</label>
        <button
          type="button"
          className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground flex items-center gap-1 transition-colors"
          onClick={onManageProviders}
        >
          <Settings2 className="size-2.5" />
          Manage providers
        </button>
      </div>
      <div className="space-y-2">
        <select
          value={story.settings.providerId ?? ''}
          onChange={(e) => handleProviderChange(e.target.value)}
          className={selectClass}
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
        <div>
          <div className="flex gap-1.5">
            {models.length > 0 && !useCustomModel ? (
              <select
                value={story.settings.modelId ?? ''}
                onChange={(e) => {
                  const value = e.target.value || null
                  updateMutation.mutate({ modelId: value })
                }}
                className={selectClass + ' flex-1'}
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
                onChange={(e) => {
                  const value = e.target.value || null
                  updateMutation.mutate({ modelId: value })
                }}
                placeholder={defaultModel || 'model id'}
                className={selectClass + ' flex-1'}
                disabled={updateMutation.isPending}
              />
            )}
            {effectiveProviderId && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs shrink-0"
                onClick={handleFetchModels}
                disabled={fetching}
                title="Fetch available models"
              >
                {fetching ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              </Button>
            )}
          </div>
          {models.length > 0 && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground mt-1 underline"
              onClick={() => setUseCustomModel(!useCustomModel)}
            >
              {useCustomModel ? 'Use fetched models' : 'Type manually'}
            </button>
          )}
          {error && (
            <p className="text-[11px] text-destructive mt-1">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function SettingsPanel({ storyId, story, onManageProviders }: SettingsPanelProps) {
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

  const toggleFormat = () => {
    const next = story.settings.outputFormat === 'plaintext' ? 'markdown' : 'plaintext'
    updateMutation.mutate({ outputFormat: next })
  }

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
    <div className="p-4 space-y-5">
      {/* Theme */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">Theme</label>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={theme === 'light' ? 'default' : 'outline'}
            className="h-7 text-xs gap-1.5"
            onClick={() => setTheme('light')}
          >
            <Sun className="size-3" />
            Light
          </Button>
          <Button
            size="sm"
            variant={theme === 'dark' ? 'default' : 'outline'}
            className="h-7 text-xs gap-1.5"
            onClick={() => setTheme('dark')}
          >
            <Moon className="size-3" />
            Dark
          </Button>
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* Quick Switch */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">Quick Switch</label>
        <p className="text-xs text-muted-foreground/60 mb-2">
          Show chevrons on prose blocks to quickly switch between variations.
        </p>
        <Button
          size="sm"
          variant={quickSwitch ? 'default' : 'outline'}
          className="h-7 text-xs gap-1.5"
          onClick={() => setQuickSwitch(!quickSwitch)}
        >
          <ChevronsLeftRight className="size-3" />
          {quickSwitch ? 'On' : 'Off'}
        </Button>
      </div>

      <div className="h-px bg-border/30" />

      {/* Output Format */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">Output Format</label>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={story.settings.outputFormat === 'plaintext' ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={toggleFormat}
            disabled={updateMutation.isPending}
          >
            Plaintext
          </Button>
          <Button
            size="sm"
            variant={story.settings.outputFormat === 'markdown' ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={toggleFormat}
            disabled={updateMutation.isPending}
          >
            Markdown
          </Button>
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* Summarization Threshold */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">
          Summarization Threshold
        </label>
        <p className="text-xs text-muted-foreground/60 mb-2">
          Only summarize prose fragments that are at least this many positions back from the most recent.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={20}
            value={story.settings.summarizationThreshold ?? 4}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10)
              if (!isNaN(value) && value >= 0 && value <= 20) {
                updateMutation.mutate({ summarizationThreshold: value })
              }
            }}
            className="w-16 h-7 px-2 text-sm bg-background border border-border/40 rounded-md focus:border-primary/30 focus:outline-none"
            disabled={updateMutation.isPending}
          />
          <span className="text-xs text-muted-foreground/40">positions back</span>
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* Max Steps */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">
          Max Steps
        </label>
        <p className="text-xs text-muted-foreground/60 mb-2">
          Maximum number of tool-use rounds the LLM can take per generation.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={50}
            value={story.settings.maxSteps ?? 10}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10)
              if (!isNaN(value) && value >= 1 && value <= 50) {
                updateMutation.mutate({ maxSteps: value })
              }
            }}
            className="w-16 h-7 px-2 text-sm bg-background border border-border/40 rounded-md focus:border-primary/30 focus:outline-none"
            disabled={updateMutation.isPending}
          />
          <span className="text-xs text-muted-foreground/40">steps</span>
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* Context Ordering */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">
          Context Ordering
        </label>
        <p className="text-xs text-muted-foreground/60 mb-2">
          Controls how pinned fragments are ordered in LLM context.
        </p>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={(story.settings.contextOrderMode ?? 'simple') === 'simple' ? 'default' : 'outline'}
            className="h-7 text-xs gap-1.5"
            onClick={() => updateMutation.mutate({ contextOrderMode: 'simple' })}
            disabled={updateMutation.isPending}
          >
            <List className="size-3" />
            Simple
          </Button>
          <Button
            size="sm"
            variant={(story.settings.contextOrderMode ?? 'simple') === 'advanced' ? 'default' : 'outline'}
            className="h-7 text-xs gap-1.5"
            onClick={() => updateMutation.mutate({ contextOrderMode: 'advanced' })}
            disabled={updateMutation.isPending}
          >
            <Shuffle className="size-3" />
            Advanced
          </Button>
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* LLM */}
      <ModelSelector
        story={story}
        globalConfig={globalConfig ?? null}
        updateMutation={updateMutation}
        onManageProviders={onManageProviders}
      />

      <div className="h-px bg-border/30" />

      {/* Plugins */}
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2 block">Plugins</label>
        {plugins && plugins.length > 0 ? (
          <div className="space-y-2.5">
            {plugins.map((plugin) => {
              const isEnabled = story.settings.enabledPlugins.includes(plugin.name)
              return (
                <div key={plugin.name} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{plugin.name}</p>
                    <p className="text-xs text-muted-foreground/50">{plugin.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={isEnabled ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => togglePlugin(plugin.name)}
                    disabled={updateMutation.isPending}
                  >
                    {isEnabled ? 'On' : 'Off'}
                  </Button>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/40 italic">No plugins available</p>
        )}
      </div>

      {/* Attribution */}
      <div className="pt-4 mt-2 border-t border-border/20">
        <p className="text-[10px] text-muted-foreground/30 text-center leading-relaxed">
          Errata v{__BUILD_VERSION__}
          <br />
          Built by{' '}
          <a
            href="https://github.com/nokusukun"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-muted-foreground/50 transition-colors"
          >
            nokusukun
          </a>
        </p>
      </div>
    </div>
  )
}
