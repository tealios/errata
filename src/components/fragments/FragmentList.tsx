import { useState, useMemo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Pin } from 'lucide-react'

interface FragmentListProps {
  storyId: string
  type?: string
  onSelect: (fragment: Fragment) => void
  onCreateNew: () => void
  selectedId?: string
}

type SortMode = 'name' | 'newest' | 'oldest' | 'order'

export function FragmentList({
  storyId,
  type,
  onSelect,
  onCreateNew,
  selectedId,
}: FragmentListProps) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('order')
  const queryClient = useQueryClient()

  const { data: fragments, isLoading } = useQuery({
    queryKey: ['fragments', storyId, type],
    queryFn: () => api.fragments.list(storyId, type),
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

  const filtered = useMemo(() => {
    if (!fragments) return []
    let list = [...fragments]

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
  }, [fragments, search, sort])

  if (isLoading) {
    return <p className="text-sm text-muted-foreground p-4">Loading...</p>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + Sort controls */}
      <div className="p-3 space-y-2 border-b border-border/50">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="h-7 text-xs bg-transparent"
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-0.5">
            {(['order', 'name', 'newest', 'oldest'] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSort(mode)}
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
          <Button size="icon" variant="ghost" className="size-6 text-muted-foreground/50 hover:text-foreground" onClick={onCreateNew}>
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground/50 py-8 text-center italic">
              {search.trim() ? 'No matches' : 'No fragments yet'}
            </p>
          )}
          {filtered.map((fragment) => (
            <div
              key={fragment.id}
              className={`group flex items-start gap-2 rounded-md px-3 py-2.5 text-sm transition-colors duration-100 hover:bg-accent/50 ${
                selectedId === fragment.id ? 'bg-accent' : ''
              }`}
            >
              <button
                onClick={() => onSelect(fragment)}
                className="flex-1 text-left min-w-0"
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
