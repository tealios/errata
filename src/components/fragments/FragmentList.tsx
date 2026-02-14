import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

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

  const { data: fragments, isLoading } = useQuery({
    queryKey: ['fragments', storyId, type],
    queryFn: () => api.fragments.list(storyId, type),
  })

  const filtered = useMemo(() => {
    if (!fragments) return []
    let list = [...fragments]

    // Filter by search term
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q),
      )
    }

    // Sort
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
    return <p className="text-sm text-muted-foreground p-2">Loading...</p>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-2 border-b">
        <span className="text-sm font-medium capitalize">{type ?? 'All'}</span>
        <Button size="sm" variant="ghost" onClick={onCreateNew}>
          + New
        </Button>
      </div>

      {/* Search + Sort controls */}
      <div className="p-2 space-y-1 border-b">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="h-7 text-xs"
        />
        <div className="flex gap-1">
          {(['order', 'name', 'newest', 'oldest'] as SortMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setSort(mode)}
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                sort === mode
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">
              {search.trim() ? 'No matches' : 'No fragments yet'}
            </p>
          )}
          {filtered.map((fragment) => (
            <button
              key={fragment.id}
              onClick={() => onSelect(fragment)}
              className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${
                selectedId === fragment.id ? 'bg-accent' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {fragment.id}
                </Badge>
                {fragment.sticky && (
                  <Badge variant="secondary" className="text-[10px]">
                    sticky
                  </Badge>
                )}
              </div>
              <p className="font-medium mt-1 truncate">{fragment.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {fragment.description}
              </p>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
