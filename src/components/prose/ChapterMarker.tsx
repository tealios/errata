import { useState, useRef, useCallback, memo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Bookmark, Sparkles, ChevronDown, ChevronUp, Pencil, Trash2, Loader2 } from 'lucide-react'

interface ChapterMarkerProps {
  storyId: string
  fragment: Fragment
  displayIndex: number
  sectionIndex: number
  onSelect: (fragment: Fragment) => void
  onDelete: (sectionIndex: number) => void
}

export const ChapterMarker = memo(function ChapterMarker({
  storyId,
  fragment,
  displayIndex,
  sectionIndex,
  onSelect,
  onDelete,
}: ChapterMarkerProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const titleRef = useRef<HTMLSpanElement>(null)
  const queryClient = useQueryClient()

  const renameMutation = useMutation({
    mutationFn: (name: string) =>
      api.fragments.update(storyId, fragment.id, {
        name,
        description: fragment.description,
        content: fragment.content,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    },
  })

  const summarizeMutation = useMutation({
    mutationFn: () => api.chapters.summarize(storyId, fragment.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      setSummaryExpanded(true)
    },
  })

  const handleTitleBlur = useCallback(() => {
    setIsEditing(false)
    const newName = titleRef.current?.textContent?.trim()
    if (newName && newName !== fragment.name) {
      renameMutation.mutate(newName)
    } else if (titleRef.current) {
      titleRef.current.textContent = fragment.name
    }
  }, [fragment.name, renameMutation])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      titleRef.current?.blur()
    }
    if (e.key === 'Escape') {
      if (titleRef.current) titleRef.current.textContent = fragment.name
      titleRef.current?.blur()
    }
  }, [fragment.name])

  const hasSummary = fragment.content.trim().length > 0

  return (
    <div
      data-prose-index={displayIndex}
      data-component-id={`chapter-marker-${fragment.id}`}
      className="group/chapter relative py-6 my-2"
    >
      {/* Horizontal rule with centered badge */}
      <div className="relative flex items-center">
        {/* Left line */}
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-amber-500/30" />

        {/* Center badge */}
        <div className="flex items-center gap-2 px-4">
          <Bookmark className="size-3 text-amber-500/60 shrink-0" />
          <span
            ref={titleRef}
            contentEditable={isEditing}
            suppressContentEditableWarning
            onClick={() => {
              setIsEditing(true)
              // Focus after React re-render
              requestAnimationFrame(() => titleRef.current?.focus())
            }}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            className={`text-xs font-medium tracking-wide text-amber-400/80 outline-none cursor-text select-text ${
              isEditing
                ? 'border-b border-amber-500/40 pb-px'
                : 'border-b border-transparent hover:border-amber-500/20 pb-px'
            }`}
          >
            {fragment.name}
          </span>
        </div>

        {/* Right line */}
        <div className="flex-1 h-px bg-gradient-to-l from-transparent via-amber-500/20 to-amber-500/30" />
      </div>

      {/* Action bar — visible on hover */}
      <div className="flex items-center justify-center gap-1 mt-2 opacity-0 group-hover/chapter:opacity-100 transition-opacity duration-200">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onSelect(fragment)}
              className="flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-amber-400/70 hover:bg-amber-500/10 transition-colors duration-200"
            >
              <Pencil className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">Edit chapter</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => summarizeMutation.mutate()}
              disabled={summarizeMutation.isPending}
              className="flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-amber-400/70 hover:bg-amber-500/10 transition-colors duration-200 disabled:opacity-40"
            >
              {summarizeMutation.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">Generate summary</TooltipContent>
        </Tooltip>

        {hasSummary && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSummaryExpanded(!summaryExpanded)}
                className="flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-amber-400/70 hover:bg-amber-500/10 transition-colors duration-200"
              >
                {summaryExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[10px]">{summaryExpanded ? 'Collapse summary' : 'Expand summary'}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onDelete(sectionIndex)}
              className="flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-red-400/70 hover:bg-red-500/10 transition-colors duration-200"
            >
              <Trash2 className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">Delete chapter</TooltipContent>
        </Tooltip>
      </div>

      {/* Summary — collapsible */}
      {hasSummary && summaryExpanded && (
        <div className="mt-3 mx-auto max-w-md animate-in fade-in slide-in-from-top-1 duration-200">
          <p className="text-[11px] leading-relaxed text-muted-foreground italic text-center px-4">
            {fragment.content}
          </p>
        </div>
      )}
    </div>
  )
})
