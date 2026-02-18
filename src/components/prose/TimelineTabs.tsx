import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type BranchMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { GitBranch, Plus, MoreVertical, Pencil, Trash2, EyeOff } from 'lucide-react'

interface TimelineTabsProps {
  storyId: string
  branches: BranchMeta[]
  activeBranchId: string
  onHide: () => void
}

export function TimelineTabs({ storyId, branches, activeBranchId, onHide }: TimelineTabsProps) {
  const queryClient = useQueryClient()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creatingTimeline, setCreatingTimeline] = useState(false)
  const [newTimelineName, setNewTimelineName] = useState('')

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
    mutationFn: (name: string) => api.branches.create(storyId, { name, parentBranchId: activeBranchId }),
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

  const startRename = (branch: BranchMeta) => {
    setRenamingId(branch.id)
    setRenameValue(branch.name)
  }

  const submitRename = () => {
    if (renamingId && renameValue.trim()) {
      renameMutation.mutate({ branchId: renamingId, name: renameValue.trim() })
    }
  }

  return (
    <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border/30 bg-muted/20 overflow-x-auto" data-component-id="timeline-tabs">
      {branches.map((branch) => {
        const isActive = branch.id === activeBranchId
        const isMain = branch.id === 'main'

        if (renamingId === branch.id) {
          return (
            <div key={branch.id} className="flex items-center gap-1">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="h-6 w-28 rounded border border-primary/30 bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                onBlur={submitRename}
              />
            </div>
          )
        }

        return (
          <div key={branch.id} className="flex items-center group/tab">
            <button
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-all ${
                isActive
                  ? 'bg-background text-foreground shadow-sm border border-border/50 font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
              onClick={() => {
                if (!isActive) switchMutation.mutate(branch.id)
              }}
              data-component-id={`timeline-tab-${branch.id}`}
            >
              {!isMain && <GitBranch className="size-3 opacity-50" />}
              {branch.name}
            </button>

            {isActive && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-0.5 rounded text-muted-foreground/30 hover:text-muted-foreground transition-colors opacity-0 group-hover/tab:opacity-100">
                    <MoreVertical className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[120px]">
                  <DropdownMenuItem onClick={() => startRename(branch)}>
                    <Pencil className="size-3 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  {!isMain && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        if (window.confirm(`Delete timeline "${branch.name}"? This cannot be undone.`)) {
                          deleteMutation.mutate(branch.id)
                        }
                      }}
                    >
                      <Trash2 className="size-3 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      })}

      {/* Create timeline */}
      {creatingTimeline ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={newTimelineName}
            onChange={(e) => setNewTimelineName(e.target.value)}
            placeholder="Timeline name..."
            className="h-6 w-28 rounded border border-primary/30 bg-background px-2 text-xs placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
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
            onBlur={() => {
              if (!newTimelineName.trim()) {
                setCreatingTimeline(false)
              }
            }}
          />
        </div>
      ) : (
        <Button
          size="icon"
          variant="ghost"
          className="size-6 text-muted-foreground/40 hover:text-foreground shrink-0"
          onClick={() => setCreatingTimeline(true)}
          title="Create timeline from current"
          data-component-id="timeline-create-button"
        >
          <Plus className="size-3" />
        </Button>
      )}

      {/* Hide timeline bar */}
      <div className="ml-auto shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="size-6 text-muted-foreground/30 hover:text-muted-foreground shrink-0"
          onClick={onHide}
          title="Hide timeline bar"
          data-component-id="timeline-hide-button"
        >
          <EyeOff className="size-3" />
        </Button>
      </div>
    </div>
  )
}
