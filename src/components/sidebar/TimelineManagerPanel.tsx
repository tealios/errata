import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type BranchMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { GitBranch, Plus, Pencil, Trash2, Check, X } from 'lucide-react'

interface TimelineManagerPanelProps {
  storyId: string
}

export function TimelineManagerPanel({ storyId }: TimelineManagerPanelProps) {
  const queryClient = useQueryClient()
  const [creatingTimeline, setCreatingTimeline] = useState(false)
  const [newTimelineName, setNewTimelineName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const { data: branchesIndex } = useQuery({
    queryKey: ['branches', storyId],
    queryFn: () => api.branches.list(storyId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['branches', storyId] })
    queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
    queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
  }

  const switchMutation = useMutation({
    mutationFn: (branchId: string) => api.branches.switchActive(storyId, branchId),
    onSuccess: invalidate,
  })

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      api.branches.create(storyId, {
        name,
        parentBranchId: branchesIndex?.activeBranchId ?? 'main',
      }),
    onSuccess: () => {
      invalidate()
      setCreatingTimeline(false)
      setNewTimelineName('')
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ branchId, name }: { branchId: string; name: string }) =>
      api.branches.rename(storyId, branchId, name),
    onSuccess: () => {
      invalidate()
      setRenamingId(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (branchId: string) => api.branches.delete(storyId, branchId),
    onSuccess: invalidate,
  })

  const branches = branchesIndex?.branches ?? []
  const activeBranchId = branchesIndex?.activeBranchId ?? 'main'

  const startRename = (branch: BranchMeta) => {
    setRenamingId(branch.id)
    setRenameValue(branch.name)
  }

  const submitRename = () => {
    if (renamingId && renameValue.trim()) {
      renameMutation.mutate({ branchId: renamingId, name: renameValue.trim() })
    } else {
      setRenamingId(null)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground/50">
            {branches.length} {branches.length === 1 ? 'timeline' : 'timelines'}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => setCreatingTimeline(true)}
          >
            <Plus className="size-3" />
            New Timeline
          </Button>
        </div>

        {creatingTimeline && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTimelineName}
              onChange={(e) => setNewTimelineName(e.target.value)}
              placeholder="Timeline name..."
              className="flex-1 h-7 rounded-md border border-border/50 bg-background px-2 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTimelineName.trim()) {
                  createMutation.mutate(newTimelineName.trim())
                }
                if (e.key === 'Escape') {
                  setCreatingTimeline(false)
                  setNewTimelineName('')
                }
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => {
                if (newTimelineName.trim()) createMutation.mutate(newTimelineName.trim())
              }}
              disabled={!newTimelineName.trim() || createMutation.isPending}
            >
              <Check className="size-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => { setCreatingTimeline(false); setNewTimelineName('') }}
            >
              <X className="size-3" />
            </Button>
          </div>
        )}

        <div className="space-y-1">
          {branches.map((branch) => {
            const isActive = branch.id === activeBranchId
            const isMain = branch.id === 'main'
            const parent = branch.parentBranchId
              ? branches.find(b => b.id === branch.parentBranchId)
              : null

            return (
              <div
                key={branch.id}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
                  isActive
                    ? 'bg-primary/5 ring-1 ring-primary/10'
                    : 'hover:bg-muted/50 cursor-pointer'
                }`}
                onClick={() => {
                  if (!isActive) switchMutation.mutate(branch.id)
                }}
                role={!isActive ? 'button' : undefined}
                tabIndex={!isActive ? 0 : undefined}
              >
                <GitBranch className={`size-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground/40'}`} />

                <div className="flex-1 min-w-0">
                  {renamingId === branch.id ? (
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="w-full h-5 rounded border border-primary/30 bg-background px-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onBlur={submitRename}
                    />
                  ) : (
                    <>
                      <p className={`text-sm truncate ${isActive ? 'font-medium' : ''}`}>
                        {branch.name}
                      </p>
                      {parent && (
                        <p className="text-[10px] text-muted-foreground/40 truncate">
                          from {parent.name}
                          {branch.forkAfterIndex !== undefined && ` at section ${branch.forkAfterIndex + 1}`}
                        </p>
                      )}
                    </>
                  )}
                </div>

                {isActive && (
                  <span className="text-[10px] text-primary/60 font-medium shrink-0">active</span>
                )}

                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="p-1 rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/50 transition-all"
                    onClick={() => startRename(branch)}
                    title="Rename"
                  >
                    <Pencil className="size-3" />
                  </button>
                  {!isMain && (
                    <button
                      className="p-1 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all"
                      onClick={() => {
                        if (window.confirm(`Delete timeline "${branch.name}"?`)) {
                          deleteMutation.mutate(branch.id)
                        }
                      }}
                      title="Delete timeline"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </ScrollArea>
  )
}
