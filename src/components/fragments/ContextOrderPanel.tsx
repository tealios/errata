import { useState, useRef, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api, type Fragment, type StoryMeta } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { GripVertical, Monitor, User } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ContextOrderPanelProps {
  storyId: string
  story: StoryMeta
}

export function ContextOrderPanel({ storyId, story }: ContextOrderPanelProps) {
  const queryClient = useQueryClient()
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const { data: characters } = useQuery({
    queryKey: ['fragments', storyId, 'character'],
    queryFn: () => api.fragments.list(storyId, 'character'),
  })

  const { data: guidelines } = useQuery({
    queryKey: ['fragments', storyId, 'guideline'],
    queryFn: () => api.fragments.list(storyId, 'guideline'),
  })

  const { data: knowledge } = useQuery({
    queryKey: ['fragments', storyId, 'knowledge'],
    queryFn: () => api.fragments.list(storyId, 'knowledge'),
  })

  const settingsMutation = useMutation({
    mutationFn: (data: { fragmentOrder?: string[] }) =>
      api.settings.update(storyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
    },
  })

  const placementMutation = useMutation({
    mutationFn: ({ fragmentId, placement }: { fragmentId: string; placement: 'system' | 'user' }) =>
      api.fragments.setPlacement(storyId, fragmentId, placement),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    },
  })

  // Get all sticky non-prose fragments, ordered by fragmentOrder then order field
  const stickyFragments = useMemo(() => {
    const all: Fragment[] = [
      ...(characters ?? []),
      ...(guidelines ?? []),
      ...(knowledge ?? []),
    ].filter((f) => f.sticky)

    const fragmentOrder = story.settings.fragmentOrder ?? []
    const orderMap = new Map(fragmentOrder.map((id, i) => [id, i]))

    return all.sort((a, b) => {
      const aIdx = orderMap.get(a.id)
      const bIdx = orderMap.get(b.id)
      // Fragments in the order list come first, sorted by their position
      if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx
      if (aIdx !== undefined) return -1
      if (bIdx !== undefined) return 1
      // Fallback to order field
      return a.order - b.order || a.createdAt.localeCompare(b.createdAt)
    })
  }, [characters, guidelines, knowledge, story.settings.fragmentOrder])

  const handleDragStart = useCallback((index: number) => {
    dragItem.current = index
    setDragIndex(index)
  }, [])

  const handleDragEnter = useCallback((index: number) => {
    dragOverItem.current = index
  }, [])

  const handleDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current) {
      setDragIndex(null)
      return
    }
    const reordered = [...stickyFragments]
    const [removed] = reordered.splice(dragItem.current, 1)
    reordered.splice(dragOverItem.current, 0, removed)

    const newOrder = reordered.map((f) => f.id)
    settingsMutation.mutate({ fragmentOrder: newOrder })

    dragItem.current = null
    dragOverItem.current = null
    setDragIndex(null)
  }, [stickyFragments, settingsMutation])

  const typeBadgeColor: Record<string, string> = {
    character: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    guideline: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    knowledge: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  }

  if (stickyFragments.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-muted-foreground/60 italic">
          No pinned fragments. Pin fragments from the Characters, Guidelines, or Knowledge panels.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border/30">
        <p className="text-[11px] text-muted-foreground/50 leading-snug">
          Drag to reorder how pinned fragments appear in the AI context
        </p>
      </div>

      <ScrollArea className="flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
        <div className="px-2 py-3 space-y-1">
          {stickyFragments.map((fragment, index) => (
            <div
              key={fragment.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragEnter={() => handleDragEnter(index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              className={cn(
                'group flex items-center gap-2 rounded-lg border border-border/30 px-2.5 py-2 cursor-grab select-none transition-all duration-150 hover:bg-accent/30',
                dragIndex === index && 'opacity-40 scale-[0.97]',
              )}
            >
              {/* Drag handle */}
              <div className="shrink-0 opacity-0 group-hover:opacity-50 transition-opacity duration-150 -ml-0.5">
                <GripVertical className="size-3.5 text-muted-foreground" />
              </div>

              {/* Fragment info */}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate leading-tight">{fragment.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-mono text-muted-foreground/50">
                    {fragment.id}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn('text-[9px] h-3.5 px-1', typeBadgeColor[fragment.type] ?? '')}
                  >
                    {fragment.type}
                  </Badge>
                  {fragment.placement === 'system' && (
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1 text-muted-foreground/50 bg-muted/30 border-transparent">
                      sys
                    </Badge>
                  )}
                </div>
              </div>

              {/* Placement toggle */}
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0 text-muted-foreground/55 hover:text-foreground"
                onClick={() =>
                  placementMutation.mutate({
                    fragmentId: fragment.id,
                    placement: fragment.placement === 'system' ? 'user' : 'system',
                  })
                }
                disabled={placementMutation.isPending}
                title={fragment.placement === 'system' ? 'Move to user message' : 'Move to system message'}
              >
                {fragment.placement === 'system' ? (
                  <Monitor className="size-3.5" />
                ) : (
                  <User className="size-3.5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
