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
    mutationFn: (data: { enabledPlugins?: string[]; outputFormat?: 'plaintext' | 'markdown' }) =>
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
