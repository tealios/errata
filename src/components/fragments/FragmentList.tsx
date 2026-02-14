import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { componentId, fragmentComponentId } from '@/lib/dom-ids'
import { resolveFragmentVisual, generateBubbles } from '@/lib/fragment-visuals'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Pin, GripVertical } from 'lucide-react'

interface FragmentListProps {
  storyId: string
  type?: string
  allowedTypes?: string[]
  listIdBase?: string
  onSelect: (fragment: Fragment) => void
  onCreateNew: () => void
  selectedId?: string
}

type SortMode = 'name' | 'newest' | 'oldest' | 'order'

export function FragmentList({
  storyId,
  type,
  allowedTypes,
  listIdBase,
  onSelect,
  onCreateNew,
  selectedId,
}: FragmentListProps) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('order')
  const queryClient = useQueryClient()
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const { data: fragments, isLoading } = useQuery({
    queryKey: ['fragments', storyId, type, allowedTypes?.join(',') ?? 'all'],
    queryFn: () => api.fragments.list(storyId, type),
  })

  const { data: imageFragments } = useQuery({
    queryKey: ['fragments', storyId, 'image'],
    queryFn: () => api.fragments.list(storyId, 'image'),
  })

  const { data: iconFragments } = useQuery({
    queryKey: ['fragments', storyId, 'icon'],
    queryFn: () => api.fragments.list(storyId, 'icon'),
  })

  const pinMutation = useMutation({
    mutationFn: (fragment: Fragment) =>
      api.fragments.update(storyId, fragment.id, {
        name: fragment.name,
        description: fragment.description,
        content: fragment.content,
        sticky: !fragment.sticky,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    },
  })

  const reorderMutation = useMutation({
    mutationFn: (items: Array<{ id: string; order: number }>) =>
      api.fragments.reorder(storyId, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    },
  })

  const filtered = useMemo(() => {
    if (!fragments) return []
    let list = [...fragments]

    if (allowedTypes && allowedTypes.length > 0) {
      list = list.filter((f) => allowedTypes.includes(f.type))
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q),
      )
    }

    switch (sort) {
      case 'name':
        list.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'newest':
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        break
      case 'oldest':
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        break
      case 'order':
      default:
        list.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
        break
    }

    return list
  }, [fragments, search, sort, allowedTypes])

  const mediaById = useMemo(() => {
    const map = new Map<string, Fragment>()
    for (const fragment of imageFragments ?? []) {
      map.set(fragment.id, fragment)
    }
    for (const fragment of iconFragments ?? []) {
      map.set(fragment.id, fragment)
    }
    return map
  }, [imageFragments, iconFragments])

  const canDrag = sort === 'order' && !search.trim()

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
    const reordered = [...filtered]
    const [removed] = reordered.splice(dragItem.current, 1)
    reordered.splice(dragOverItem.current, 0, removed)

    const items = reordered.map((f, i) => ({ id: f.id, order: i }))
    reorderMutation.mutate(items)

    dragItem.current = null
    dragOverItem.current = null
    setDragIndex(null)
  }, [filtered, reorderMutation])

  if (isLoading) {
    return <p className="text-sm text-muted-foreground p-4">Loading...</p>
  }

  return (
    <div className="flex flex-col h-full" data-component-id={listIdBase ?? componentId(type ?? 'fragment', 'sidebar-list')}>
      {/* Search + Sort controls */}
      <div className="px-3 pt-3 pb-2 space-y-2 border-b border-border/50" data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'list-controls')}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="h-7 text-xs bg-transparent"
          data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'list-search')}
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-0.5">
            {(['order', 'name', 'newest', 'oldest'] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSort(mode)}
                data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'sort', mode)}
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                  sort === mode
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground/50 hover:text-muted-foreground'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <Button size="icon" variant="ghost" className="size-6 text-muted-foreground/50 hover:text-foreground" onClick={onCreateNew} data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'create-button')}>
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Pinning info */}
      <div className="px-3 py-2.5 border-b border-border/30">
        <p className="text-[10px] text-muted-foreground/40 leading-relaxed">
          <Pin className="size-2.5 inline -mt-0.5 mr-0.5" />
          Pinned fragments are always sent to the AI. Unpinned ones appear as a shortlist.
        </p>
      </div>

      <ScrollArea className="flex-1" data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'list-scroll')}>
        <div className="p-2 space-y-1" data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'list-items')}>
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground/50 py-8 text-center italic">
              {search.trim() ? 'No matches' : 'No fragments yet'}
            </p>
          )}
          {filtered.map((fragment, index) => (
            <div
              key={fragment.id}
              data-component-id={fragmentComponentId(fragment, 'list-item')}
              draggable={canDrag}
              onDragStart={() => handleDragStart(index)}
              onDragEnter={() => handleDragEnter(index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              className={`group flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-sm transition-colors duration-100 hover:bg-accent/50 ${
                selectedId === fragment.id ? 'bg-accent' : ''
              } ${dragIndex === index ? 'opacity-50' : ''}`}
            >
              {/* Drag handle */}
              {canDrag && (
                <div className="shrink-0 pt-0.5 cursor-grab opacity-0 group-hover:opacity-40 hover:!opacity-70 transition-opacity">
                  <GripVertical className="size-3.5 text-muted-foreground" data-component-id={fragmentComponentId(fragment, 'drag-handle')} />
                </div>
              )}

              {(() => {
                const visual = resolveFragmentVisual(fragment, mediaById)
                const boundary = visual.boundary

                if (visual.imageUrl) {
                  if (boundary && boundary.width < 1 && boundary.height < 1) {
                    // Zoom into the cropped region
                    const bgPosX = boundary.width < 1 ? (boundary.x / (1 - boundary.width)) * 100 : 50
                    const bgPosY = boundary.height < 1 ? (boundary.y / (1 - boundary.height)) * 100 : 50
                    return (
                      <div
                        className="size-9 shrink-0 rounded-lg overflow-hidden border border-border/40 bg-muted bg-no-repeat"
                        style={{
                          backgroundImage: `url("${visual.imageUrl}")`,
                          backgroundSize: `${100 / boundary.width}% ${100 / boundary.height}%`,
                          backgroundPosition: `${bgPosX}% ${bgPosY}%`,
                        }}
                      />
                    )
                  }
                  return (
                    <div className="size-9 shrink-0 rounded-lg overflow-hidden border border-border/40 bg-muted">
                      <img src={visual.imageUrl} alt="" className="size-full object-cover" />
                    </div>
                  )
                }

                const bubbleSet = generateBubbles(fragment.id, fragment.type)
                return (
                  <div className="size-9 shrink-0 rounded-lg overflow-hidden">
                    <svg viewBox="0 0 36 36" className="size-full" aria-hidden>
                      <rect width="36" height="36" fill={bubbleSet.bg} />
                      {bubbleSet.bubbles.map((b, i) => (
                        <circle
                          key={i}
                          cx={b.cx}
                          cy={b.cy}
                          r={b.r}
                          fill={b.color}
                          opacity={b.opacity}
                        />
                      ))}
                    </svg>
                  </div>
                )
              })()}

              <button
                onClick={() => onSelect(fragment)}
                className="flex-1 text-left min-w-0"
                data-component-id={fragmentComponentId(fragment, 'select')}
              >
                <p className="font-medium text-sm truncate leading-tight">{fragment.name}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] font-mono text-muted-foreground/40">
                    {fragment.id}
                  </span>
                  {fragment.sticky && (
                    <Badge variant="secondary" className="text-[9px] h-3.5 px-1">
                      pinned
                    </Badge>
                  )}
                  {fragment.sticky && fragment.placement === 'system' && (
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                      sys
                    </Badge>
                  )}
                  {(type === undefined || allowedTypes?.length) && (
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                      {fragment.type}
                    </Badge>
                  )}
                </div>
                {fragment.description && (
                  <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                    {fragment.description}
                  </p>
                )}
              </button>

              {/* Pin button - visible on hover or when pinned */}
              <Button
                size="icon"
                variant="ghost"
                data-component-id={fragmentComponentId(fragment, 'pin-toggle')}
                className={`size-6 shrink-0 transition-opacity ${
                  fragment.sticky
                    ? 'opacity-100 text-primary'
                    : 'opacity-0 group-hover:opacity-50 hover:opacity-100 hover:text-foreground'
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  pinMutation.mutate(fragment)
                }}
                disabled={pinMutation.isPending}
                title={fragment.sticky ? 'Unpin' : 'Pin to context'}
              >
                <Pin className={`size-3.5 ${fragment.sticky ? 'fill-current' : ''}`} />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
