import { HoverCard } from 'radix-ui'
import { useCharacterMentionContext } from './CharacterMentionContext'
import { CharacterPreviewCard } from './CharacterPreviewCard'

interface CharacterMentionSpanProps {
  fragmentId: string
  className?: string
  style?: React.CSSProperties
  onClick?: (e: React.MouseEvent) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  role?: string
  tabIndex?: number
  children?: React.ReactNode
}

export function CharacterMentionSpan({
  fragmentId,
  className,
  style,
  onClick,
  onKeyDown,
  role,
  tabIndex,
  children,
}: CharacterMentionSpanProps) {
  const ctx = useCharacterMentionContext()
  const character = ctx?.getCharacter(fragmentId)

  // No context or character not found — render plain span
  if (!ctx || !character) {
    return (
      <span
        className={className}
        style={style}
        onClick={onClick}
        onKeyDown={onKeyDown}
        role={role}
        tabIndex={tabIndex}
      >
        {children}
      </span>
    )
  }

  return (
    <HoverCard.Root openDelay={400} closeDelay={200}>
      <HoverCard.Trigger asChild>
        <span
          className={className}
          style={style}
          onClick={onClick}
          onKeyDown={onKeyDown}
          role={role}
          tabIndex={tabIndex}
        >
          {children}
        </span>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="center"
          sideOffset={6}
          className="w-72 rounded-xl border border-border/50 bg-popover/95 backdrop-blur-md shadow-xl shadow-black/10 z-50 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
        >
          <CharacterPreviewCard
            character={character}
            mediaById={ctx.mediaById}
          />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}
