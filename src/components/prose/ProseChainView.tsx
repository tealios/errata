import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { InlineGenerationInput } from '@/components/generation/InlineGenerationInput'

interface ProseChainViewProps {
  storyId: string
  fragments: Fragment[]
  onSelectFragment: (fragment: Fragment) => void
  onDebugLog?: (logId: string) => void
}

export function ProseChainView({
  storyId,
  fragments,
  onSelectFragment,
  onDebugLog,
}: ProseChainViewProps) {
  const sorted = [...fragments].sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
  )

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="max-w-prose mx-auto py-6 px-6 space-y-1">
        {sorted.length > 0 ? (
          sorted.map((fragment, idx) => (
            <ProseBlock
              key={fragment.id}
              storyId={storyId}
              fragment={fragment}
              isLast={idx === sorted.length - 1}
              onSelect={() => onSelectFragment(fragment)}
              onDebugLog={onDebugLog}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-muted-foreground mb-4">No prose fragments yet.</p>
            <p className="text-sm text-muted-foreground">
              Use the input below to generate your first passage.
            </p>
          </div>
        )}

        <InlineGenerationInput storyId={storyId} onDebugLog={onDebugLog} />
      </div>
    </ScrollArea>
  )
}

function ProseBlock({
  storyId,
  fragment,
  isLast,
  onSelect,
  onDebugLog,
}: {
  storyId: string
  fragment: Fragment
  isLast: boolean
  onSelect: () => void
  onDebugLog?: (logId: string) => void
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(fragment.content)

  const updateMutation = useMutation({
    mutationFn: (content: string) =>
      api.fragments.update(storyId, fragment.id, {
        name: fragment.name,
        description: fragment.description,
        content,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      setEditing(false)
    },
  })

  const handleSave = () => {
    if (editContent !== fragment.content) {
      updateMutation.mutate(editContent)
    } else {
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <div className="rounded-md border border-accent p-3 mb-4">
        <Textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="min-h-[120px] resize-none text-sm leading-relaxed font-serif border-0 p-0 focus-visible:ring-0"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditContent(fragment.content)
              setEditing(false)
            }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              handleSave()
            }
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-muted-foreground">
            Esc to cancel, Ctrl+Enter to save
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditContent(fragment.content)
                setEditing(false)
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group relative">
      <button
        onClick={() => {
          if (isLast) {
            setEditContent(fragment.content)
            setEditing(true)
          } else {
            onSelect()
          }
        }}
        className="text-left w-full hover:bg-accent/50 rounded-md p-3 -m-3 transition-colors"
      >
        <div className="whitespace-pre-wrap text-sm leading-relaxed font-serif">
          {fragment.content}
        </div>
        <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Badge variant="outline" className="text-[10px]">
            {fragment.id}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {fragment.description}
          </span>
          {isLast && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              click to edit
            </span>
          )}
          {!!fragment.meta?.generatedFrom && (
            <Badge
              variant="secondary"
              className="text-[10px] cursor-pointer hover:bg-primary/20"
              onClick={(e) => {
                e.stopPropagation()
                onDebugLog?.(fragment.id)
              }}
            >
              AI
            </Badge>
          )}
        </div>
      </button>
      <Separator className="mt-4" />
    </div>
  )
}
