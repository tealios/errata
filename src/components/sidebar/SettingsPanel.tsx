import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

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
    <div className="p-4 space-y-4">
      {/* Output Format */}
      <div>
        <label className="text-xs text-muted-foreground mb-2 block">Output Format</label>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={story.settings.outputFormat === 'plaintext' ? 'default' : 'outline'}
            onClick={toggleFormat}
            disabled={updateMutation.isPending}
          >
            Plaintext
          </Button>
          <Button
            size="sm"
            variant={story.settings.outputFormat === 'markdown' ? 'default' : 'outline'}
            onClick={toggleFormat}
            disabled={updateMutation.isPending}
          >
            Markdown
          </Button>
        </div>
      </div>

      <Separator />

      {/* Plugins */}
      <div>
        <label className="text-xs text-muted-foreground mb-2 block">Plugins</label>
        {plugins && plugins.length > 0 ? (
          <div className="space-y-2">
            {plugins.map((plugin) => {
              const isEnabled = story.settings.enabledPlugins.includes(plugin.name)
              return (
                <div key={plugin.name} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{plugin.name}</p>
                    <p className="text-xs text-muted-foreground">{plugin.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={isEnabled ? 'default' : 'outline'}
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
          <p className="text-xs text-muted-foreground">No plugins available</p>
        )}
      </div>
    </div>
  )
}
