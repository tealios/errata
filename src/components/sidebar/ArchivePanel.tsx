import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Undo2, Trash2, Archive } from 'lucide-react'

interface ArchivePanelProps {
  storyId: string
}

export function ArchivePanel({ storyId }: ArchivePanelProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: archivedFragments, isLoading } = useQuery({
    queryKey: ['fragments-archived', storyId],
    queryFn: () => api.fragments.listArchived(storyId),
  })

  const restoreMutation = useMutation({
    mutationFn: (fragmentId: string) => api.fragments.restore(storyId, fragmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments-archived', storyId] })
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (fragmentId: string) => api.fragments.delete(storyId, fragmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments-archived', storyId] })
    },
  })

  const filtered = (archivedFragments ?? []).filter((f) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q) || f.type.toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3">
        <Input
          placeholder="Search archive..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs bg-transparent"
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3 pb-3 space-y-1">
          {isLoading && (
            <p className="text-xs text-muted-foreground/50 text-center py-8">Loading...</p>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40">
              <Archive className="size-8 mb-2" />
              <p className="text-xs">No archived fragments</p>
            </div>
          )}

          {filtered.map((fragment) => (
            <div
              key={fragment.id}
              className="flex items-center gap-2 rounded-md border border-border/30 px-3 py-2 group hover:border-border/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{fragment.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge variant="secondary" className="text-[10px] h-4">{fragment.type}</Badge>
                  <span className="text-[10px] font-mono text-muted-foreground/40">{fragment.id}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={() => restoreMutation.mutate(fragment.id)}
                  disabled={restoreMutation.isPending}
                  title="Restore"
                >
                  <Undo2 className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (confirm('Permanently delete this fragment? This cannot be undone.')) {
                      deleteMutation.mutate(fragment.id)
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  title="Delete permanently"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
