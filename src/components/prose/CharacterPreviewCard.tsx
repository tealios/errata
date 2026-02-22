import type { Fragment } from '@/lib/api'
import { CharacterAvatar } from '@/components/shared/CharacterAvatar'
import { Badge } from '@/components/ui/badge'

export function CharacterPreviewCard({
  character,
  mediaById,
}: {
  character: Fragment
  mediaById: Map<string, Fragment>
}) {
  // Filter out internal tags (color=, etc.)
  const displayTags = character.tags
    .filter(t => !t.startsWith('color='))
    .slice(0, 3)

  return (
    <div className="flex flex-col gap-2.5 p-3">
      {/* Header: avatar + name + description */}
      <div className="flex items-start gap-3">
        <CharacterAvatar character={character} mediaById={mediaById} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="font-display text-sm tracking-tight text-popover-foreground">
            {character.name}
          </div>
          {character.description && (
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
              {character.description}
            </p>
          )}
        </div>
      </div>

      {/* Content preview */}
      {character.content && (
        <div className="relative">
          <p className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-3 mention-preview-fade">
            {character.content}
          </p>
        </div>
      )}

      {/* Tags */}
      {displayTags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {displayTags.map(tag => (
            <Badge
              key={tag}
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-4"
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
