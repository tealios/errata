import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import type { CharacterChatConversationSummary, PersonaMode } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X, Plus, Trash2, MessageSquare, User, Users, Sparkles } from 'lucide-react'
import { resolveFragmentVisual } from '@/lib/fragment-visuals'

function personaIcon(persona: PersonaMode) {
  switch (persona.type) {
    case 'stranger': return <User className="size-3" />
    case 'character': return <Users className="size-3" />
    case 'custom': return <Sparkles className="size-3" />
  }
}

function personaLabel(persona: PersonaMode, characters: Fragment[]) {
  switch (persona.type) {
    case 'stranger': return 'as stranger'
    case 'character': {
      const ch = characters.find((c) => c.id === persona.characterId)
      return `as ${ch?.name ?? 'character'}`
    }
    case 'custom': return 'custom persona'
  }
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface ConversationListProps {
  storyId: string
  characterId: string | null
  characters: Fragment[]
  mediaById: Map<string, Fragment>
  onSelect: (conv: CharacterChatConversationSummary) => void
  onNew: () => void
  onClose: () => void
}

export function ConversationList({
  storyId,
  characterId,
  characters,
  mediaById,
  onSelect,
  onNew,
  onClose,
}: ConversationListProps) {
  const queryClient = useQueryClient()

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['character-chat-conversations', storyId, characterId],
    queryFn: () => api.characterChat.listConversations(storyId, characterId ?? undefined),
  })

  const handleDelete = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation()
    await api.characterChat.deleteConversation(storyId, convId)
    await queryClient.invalidateQueries({ queryKey: ['character-chat-conversations', storyId] })
  }

  // Group conversations by character
  const grouped = new Map<string, CharacterChatConversationSummary[]>()
  for (const conv of conversations ?? []) {
    const key = conv.characterId
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(conv)
  }

  return (
    <div
      className="absolute inset-0 z-20 bg-background/95 backdrop-blur-sm flex flex-col"
      data-component-id="character-chat-conversation-list"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <h3 className="font-display text-lg tracking-tight">Conversations</h3>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={onNew}
          >
            <Plus className="size-3" />
            New
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground/40"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-1">
          {isLoading && (
            <p className="text-xs text-muted-foreground/40 italic text-center py-8">Loading...</p>
          )}

          {!isLoading && (!conversations || conversations.length === 0) && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <MessageSquare className="size-8 text-muted-foreground/15" />
              <p className="text-xs text-muted-foreground/40 italic max-w-[200px]">
                No conversations yet. Start one to talk with your characters.
              </p>
            </div>
          )}

          {[...grouped.entries()].map(([charId, convs]) => {
            const character = characters.find((c) => c.id === charId)
            return (
              <div key={charId}>
                {/* Only show group header if not filtering by character */}
                {!characterId && (
                  <div className="flex items-center gap-2 px-2 pt-3 pb-1.5 first:pt-0">
                    {character && (() => {
                      const visual = resolveFragmentVisual(character, mediaById)
                      if (!visual.imageUrl) return null
                      const boundary = visual.boundary
                      if (boundary && boundary.width < 1 && boundary.height < 1) {
                        const bgPosX = boundary.x / (1 - boundary.width) * 100
                        const bgPosY = boundary.y / (1 - boundary.height) * 100
                        return (
                          <div
                            className="size-5 shrink-0 rounded-full overflow-hidden bg-muted bg-no-repeat"
                            style={{
                              backgroundImage: `url("${visual.imageUrl}")`,
                              backgroundSize: `${100 / boundary.width}% ${100 / boundary.height}%`,
                              backgroundPosition: `${bgPosX}% ${bgPosY}%`,
                            }}
                          />
                        )
                      }
                      return (
                        <div className="size-5 shrink-0 rounded-full overflow-hidden bg-muted">
                          <img src={visual.imageUrl} alt="" className="size-full object-cover" />
                        </div>
                      )
                    })()}
                    <span className="font-display text-sm text-muted-foreground/60">
                      {character?.name ?? charId}
                    </span>
                  </div>
                )}

                {convs.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => onSelect(conv)}
                    className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left
                      hover:bg-accent/50 transition-colors group"
                  >
                    <div className="shrink-0 mt-0.5 text-muted-foreground/30">
                      {personaIcon(conv.persona)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-medium truncate">{conv.title}</span>
                        <span className="text-[10px] text-muted-foreground/30 shrink-0 ml-auto">
                          {formatRelativeTime(conv.updatedAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-muted-foreground/40">
                          {personaLabel(conv.persona, characters)}
                        </span>
                        <span className="text-[10px] text-muted-foreground/20">·</span>
                        <span className="text-[10px] text-muted-foreground/30">
                          {conv.messageCount} message{conv.messageCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/30 hover:text-destructive"
                      onClick={(e) => handleDelete(e, conv.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
