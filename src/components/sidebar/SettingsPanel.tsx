import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface SettingsPanelProps {
  storyId: string
  story: StoryMeta
}

export function SettingsPanel({ storyId, story }: SettingsPanelProps) {
  const queryClient = useQueryClient()

  const { data: plugins } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.plugins.list(),
  })

  const updateMutation = useMutation({
    mutationFn: (data: { enabledPlugins?: string[]; outputFormat?: 'plaintext' | 'markdown'; summarizationThreshold?: number }) =>
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

  return (
    <div className="p-4 space-y-5">
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
    </div>
  )
}
