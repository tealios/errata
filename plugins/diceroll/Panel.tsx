import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { PluginPanelProps } from '@/lib/plugin-panels'

interface LogEntry {
  type: 'should' | 'roll'
  question?: string
  answer?: string
  min?: number
  max?: number
  result?: number
  for?: string
  timestamp: string
}

export function DicerollPanel({ storyId }: PluginPanelProps) {
  const queryClient = useQueryClient()

  const { data: log = [] } = useQuery<LogEntry[]>({
    queryKey: ['diceroll-log', storyId],
    queryFn: async () => {
      const res = await fetch(`/api/plugins/diceroll/log?storyId=${storyId}`)
      if (!res.ok) throw new Error('Failed to fetch diceroll log')
      return res.json()
    },
    refetchInterval: 5000,
  })

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/plugins/diceroll/log?storyId=${storyId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to clear log')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diceroll-log', storyId] })
    },
  })

  const entries = [...log].reverse()

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Rolls and decisions made during generation.
        </p>
        {log.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
          >
            Clear
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          No rolls yet
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-2">
            {entries.map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                className="rounded-md border p-2 text-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span>{entry.type === 'should' ? '🎱' : '🎲'}</span>
                  <span className="font-medium">
                    {entry.type === 'should' ? 'Should' : 'Roll'}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {entry.type === 'should' ? (
                  <div>
                    <div className="text-muted-foreground">{entry.question}</div>
                    <div className="font-semibold mt-1">{entry.answer}</div>
                  </div>
                ) : (
                  <div>
                    {entry.for && (
                      <div className="text-muted-foreground">{entry.for}</div>
                    )}
                    <div className="text-muted-foreground">
                      Range: {entry.min}–{entry.max}
                    </div>
                    <div className="font-semibold mt-1">Result: {entry.result}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
