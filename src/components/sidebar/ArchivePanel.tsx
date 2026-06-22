import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner, EmptyState } from '@/components/ui/async-view'
import { Undo2, Trash2, Archive } from 'lucide-react'
import { componentId } from '@/lib/dom-ids'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface ArchivePanelProps {
  storyId: string
  onSelect?: (fragment: Fragment) => void
}

export function ArchivePanel({ storyId, onSelect }: ArchivePanelProps) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
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
    <div className="flex flex-col h-full" data-component-id="archive-panel-root">
      <div className="px-3 py-3">
        <Input
          placeholder="Search archive..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs bg-transparent"
          data-component-id="archive-search"
        />
      </div>

      <ScrollArea className="flex-1" data-component-id="archive-scroll">
        <div className="px-3 pb-3 space-y-1">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Spinner size="sm" />
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <EmptyState
              icon={<Archive className="size-5" />}
              title={search.trim() ? 'No matches' : 'Nothing archived'}
              hint={search.trim() ? undefined : 'Archived fragments appear here — drag a fragment onto the archive, or send it here from its menu.'}
              className="py-10"
            />
          )}

          {filtered.map((fragment) => (
            <div
              key={fragment.id}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={() => onSelect?.(fragment)}
              onKeyDown={(e) => {
                if (!onSelect) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(fragment)
                }
              }}
              className={`flex items-center gap-2 rounded-md border border-border/30 px-3 py-2 group hover:border-border/50 transition-colors ${
                onSelect ? 'cursor-pointer hover:bg-accent/40' : ''
              }`}
              data-component-id={componentId('archive', fragment.id, 'item')}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{fragment.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge variant="secondary" className="text-[0.625rem] h-4">{fragment.type}</Badge>
                  <span className="text-[0.625rem] font-mono text-muted-foreground">{fragment.id}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    restoreMutation.mutate(fragment.id)
                  }}
                  disabled={restoreMutation.isPending}
                  title="Restore"
                  data-component-id={componentId('archive', fragment.id, 'restore')}
                >
                  <Undo2 className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (await confirm({ title: 'Permanently delete this fragment?', description: 'This cannot be undone.', confirmText: 'Delete', destructive: true })) {
                      deleteMutation.mutate(fragment.id)
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  title="Delete permanently"
                  data-component-id={componentId('archive', fragment.id, 'delete')}
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
