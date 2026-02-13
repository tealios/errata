import { useQuery } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface FragmentListProps {
  storyId: string
  type?: string
  onSelect: (fragment: Fragment) => void
  onCreateNew: () => void
  selectedId?: string
}

export function FragmentList({
  storyId,
  type,
  onSelect,
  onCreateNew,
  selectedId,
}: FragmentListProps) {
  const { data: fragments, isLoading } = useQuery({
    queryKey: ['fragments', storyId, type],
    queryFn: () => api.fragments.list(storyId, type),
  })

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
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {fragments?.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No fragments yet
            </p>
          )}
          {fragments?.map((fragment) => (
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
