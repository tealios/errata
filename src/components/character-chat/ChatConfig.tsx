import { useMemo } from 'react'
import type { Fragment, PersonaMode, ProseChain } from '@/lib/api/types'
import { resolveFragmentVisual } from '@/lib/fragment-visuals'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  X,
  User,
  Users,
  Sparkles,
  ChevronDown,
  History,
  BookOpen,
} from 'lucide-react'

interface ChatConfigProps {
  characters: Fragment[]
  selectedCharacterId: string | null
  onCharacterChange: (id: string) => void
  persona: PersonaMode
  onPersonaChange: (persona: PersonaMode) => void
  proseChain: ProseChain | null
  proseFragments: Fragment[]
  storyPointId: string | null
  onStoryPointChange: (id: string | null) => void
  onShowConversations: () => void
  onClose: () => void
  disabled?: boolean
  mediaById: Map<string, Fragment>
}

function CharacterThumb({ character, mediaById }: { character: Fragment; mediaById: Map<string, Fragment> }) {
  const visual = resolveFragmentVisual(character, mediaById)
  if (!visual.imageUrl) return null

  const boundary = visual.boundary
  if (boundary && boundary.width < 1 && boundary.height < 1) {
    const bgPosX = boundary.x / (1 - boundary.width) * 100
    const bgPosY = boundary.y / (1 - boundary.height) * 100
    return (
      <div
        className="size-4 shrink-0 rounded-full overflow-hidden bg-muted bg-no-repeat"
        style={{
          backgroundImage: `url("${visual.imageUrl}")`,
          backgroundSize: `${100 / boundary.width}% ${100 / boundary.height}%`,
          backgroundPosition: `${bgPosX}% ${bgPosY}%`,
        }}
      />
    )
  }

  return (
    <div className="size-4 shrink-0 rounded-full overflow-hidden bg-muted">
      <img src={visual.imageUrl} alt="" className="size-full object-cover" />
    </div>
  )
}

export function ChatConfig({
  characters,
  selectedCharacterId,
  onCharacterChange,
  persona,
  onPersonaChange,
  proseChain,
  proseFragments,
  storyPointId,
  onStoryPointChange,
  onShowConversations,
  onClose,
  disabled,
  mediaById,
}: ChatConfigProps) {
  const selectedCharacter = characters.find((c) => c.id === selectedCharacterId)
  const personaCharacter = persona.type === 'character'
    ? characters.find((c) => c.id === persona.characterId)
    : null

  // Build prose chain entries for story point picker
  const proseEntries = useMemo(() => {
    if (!proseChain || !proseFragments.length) return []
    const fragmentMap = new Map(proseFragments.map((f) => [f.id, f]))
    return proseChain.entries
      .map((entry, idx) => {
        const frag = fragmentMap.get(entry.active)
        return frag ? { id: frag.id, name: frag.name, index: idx + 1 } : null
      })
      .filter((e): e is NonNullable<typeof e> => !!e)
  }, [proseChain, proseFragments])

  const storyPointLabel = storyPointId
    ? proseEntries.find((e) => e.id === storyPointId)?.name ?? 'Selected'
    : 'Latest'

  const personaLabel = persona.type === 'character'
    ? personaCharacter?.name ?? 'Character'
    : persona.type === 'stranger'
      ? 'Stranger'
      : 'Custom'

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/30 bg-card/30" data-component-id="character-chat-config">
      {/* Character selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs font-medium max-w-[180px]">
            {selectedCharacter && <CharacterThumb character={selectedCharacter} mediaById={mediaById} />}
            <span className="font-display text-sm truncate">
              {selectedCharacter?.name ?? 'Select character'}
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
          {characters.map((ch) => (
            <DropdownMenuItem
              key={ch.id}
              onClick={() => onCharacterChange(ch.id)}
              className="gap-2"
            >
              <CharacterThumb character={ch} mediaById={mediaById} />
              <span className="font-display text-sm">{ch.name}</span>
              <span className="text-[10px] text-muted-foreground/50 truncate ml-auto max-w-[120px]">
                {ch.description}
              </span>
            </DropdownMenuItem>
          ))}
          {characters.length === 0 && (
            <DropdownMenuItem disabled className="text-muted-foreground/40 italic text-xs">
              No characters yet
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="text-muted-foreground/20 text-xs select-none">/</span>

      {/* Persona selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground">
            {persona.type === 'character' && <Users className="size-3" />}
            {persona.type === 'stranger' && <User className="size-3" />}
            {persona.type === 'custom' && <Sparkles className="size-3" />}
            <span className="truncate max-w-[80px]">{personaLabel}</span>
            <ChevronDown className="size-3 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => onPersonaChange({ type: 'stranger' })}
            className="gap-2"
          >
            <User className="size-3.5" />
            <div>
              <div className="text-xs">Stranger</div>
              <div className="text-[10px] text-muted-foreground/50">Someone they just met</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {characters
            .filter((c) => c.id !== selectedCharacterId)
            .map((ch) => (
              <DropdownMenuItem
                key={ch.id}
                onClick={() => onPersonaChange({ type: 'character', characterId: ch.id })}
                className="gap-2"
              >
                <Users className="size-3.5" />
                <span className="text-xs">As {ch.name}</span>
              </DropdownMenuItem>
            ))}
          {characters.filter((c) => c.id !== selectedCharacterId).length > 0 && (
            <DropdownMenuSeparator />
          )}
          <DropdownMenuItem
            onClick={() => {
              const prompt = window.prompt('Describe your persona:')
              if (prompt?.trim()) {
                onPersonaChange({ type: 'custom', prompt: prompt.trim() })
              }
            }}
            className="gap-2"
          >
            <Sparkles className="size-3.5" />
            <div>
              <div className="text-xs">Custom persona</div>
              <div className="text-[10px] text-muted-foreground/50">Define who you are</div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="text-muted-foreground/20 text-xs select-none">/</span>

      {/* Story point picker */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground">
            <BookOpen className="size-3" />
            <span className="truncate max-w-[80px]">{storyPointLabel}</span>
            <ChevronDown className="size-3 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
          <DropdownMenuItem
            onClick={() => onStoryPointChange(null)}
            className="gap-2"
          >
            <span className="text-xs font-medium">Latest</span>
            <span className="text-[10px] text-muted-foreground/50 ml-auto">All events</span>
          </DropdownMenuItem>
          {proseEntries.length > 0 && <DropdownMenuSeparator />}
          {proseEntries.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              onClick={() => onStoryPointChange(entry.id)}
              className="gap-2"
            >
              <span className="text-[10px] text-muted-foreground/40 font-mono w-5 text-right shrink-0">
                {entry.index}
              </span>
              <span className="text-xs truncate">{entry.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Conversations button */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs text-muted-foreground/60"
        onClick={onShowConversations}
        disabled={disabled}
      >
        <History className="size-3" />
        <span className="hidden sm:inline">History</span>
      </Button>

      {/* Close */}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground/40 hover:text-muted-foreground"
        onClick={onClose}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
