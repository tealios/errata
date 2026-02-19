import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ChatEvent, type Fragment } from '@/lib/api'
import type { PersonaMode, CharacterChatConversationSummary } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, Loader2 } from 'lucide-react'
import {
  AssistantMessageView,
  type AssistantMessage,
  type ChatMessage,
} from '@/components/chat/ChatMessageParts'
import { resolveFragmentVisual } from '@/lib/fragment-visuals'
import { ChatConfig } from './ChatConfig'
import { ConversationList } from './ConversationList'

function CharacterAvatar({ character, mediaById, size = 'md' }: {
  character: Fragment
  mediaById: Map<string, Fragment>
  size?: 'sm' | 'md' | 'lg'
}) {
  const visual = resolveFragmentVisual(character, mediaById)
  const sizeClass = size === 'sm' ? 'size-6' : size === 'lg' ? 'w-14 h-14' : 'size-9'
  const textClass = size === 'sm' ? 'text-[10px]' : size === 'lg' ? 'text-xl' : 'text-sm'

  if (visual.imageUrl) {
    const boundary = visual.boundary
    if (boundary && boundary.width < 1 && boundary.height < 1) {
      const bgPosX = boundary.x / (1 - boundary.width) * 100
      const bgPosY = boundary.y / (1 - boundary.height) * 100
      return (
        <div
          className={`${sizeClass} shrink-0 rounded-full overflow-hidden border border-primary/10 bg-muted bg-no-repeat`}
          style={{
            backgroundImage: `url("${visual.imageUrl}")`,
            backgroundSize: `${100 / boundary.width}% ${100 / boundary.height}%`,
            backgroundPosition: `${bgPosX}% ${bgPosY}%`,
          }}
        />
      )
    }
    return (
      <div className={`${sizeClass} shrink-0 rounded-full overflow-hidden border border-primary/10 bg-muted`}>
        <img src={visual.imageUrl} alt="" className="size-full object-cover" />
      </div>
    )
  }

  return (
    <div className={`${sizeClass} shrink-0 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center`}>
      <span className={`font-display ${textClass} text-primary/60`}>
        {character.name.charAt(0)}
      </span>
    </div>
  )
}

interface CharacterChatViewProps {
  storyId: string
  initialCharacterId?: string | null
  onClose: () => void
}

export function CharacterChatView({ storyId, initialCharacterId, onClose }: CharacterChatViewProps) {
  const queryClient = useQueryClient()

  // Config state
  const [characterId, setCharacterId] = useState<string | null>(initialCharacterId ?? null)
  const [persona, setPersona] = useState<PersonaMode>({ type: 'stranger' })
  const [storyPointId, setStoryPointId] = useState<string | null>(null)

  // Conversation state
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showConversations, setShowConversations] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Data queries
  const { data: allFragments } = useQuery({
    queryKey: ['fragments', storyId],
    queryFn: () => api.fragments.list(storyId),
  })

  const { data: proseChain } = useQuery({
    queryKey: ['prose-chain', storyId],
    queryFn: () => api.proseChain.get(storyId),
  })

  const characters = (allFragments ?? []).filter((f) => f.type === 'character')
  const proseFragments = (allFragments ?? []).filter((f) => f.type === 'prose')

  // Build media lookup for character portraits
  const mediaById = useMemo(() => {
    const map = new Map<string, Fragment>()
    for (const f of allFragments ?? []) {
      if (f.type === 'image' || f.type === 'icon') map.set(f.id, f)
    }
    return map
  }, [allFragments])

  // Auto-select first character if none selected
  useEffect(() => {
    if (!characterId && characters.length > 0) {
      setCharacterId(characters[0].id)
    }
  }, [characterId, characters])

  const selectedCharacter = characters.find((c) => c.id === characterId)

  // Scroll to bottom on new messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Handle character change — reset conversation
  const handleCharacterChange = useCallback((id: string) => {
    setCharacterId(id)
    setConversationId(null)
    setMessages([])
    setError(null)
  }, [])

  // Start new conversation
  const startNewConversation = useCallback(() => {
    setConversationId(null)
    setMessages([])
    setError(null)
    setShowConversations(false)
    textareaRef.current?.focus()
  }, [])

  // Resume a conversation
  const resumeConversation = useCallback(async (conv: CharacterChatConversationSummary) => {
    try {
      const full = await api.characterChat.getConversation(storyId, conv.id)
      setCharacterId(full.characterId)
      setPersona(full.persona)
      setStoryPointId(full.storyPointFragmentId)
      setConversationId(full.id)
      setMessages(full.messages.map((m) => {
        if (m.role === 'assistant') {
          return {
            role: 'assistant' as const,
            content: m.content,
            ...(m.reasoning ? { reasoning: m.reasoning } : {}),
          }
        }
        return { role: 'user' as const, content: m.content }
      }))
      setError(null)
      setShowConversations(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation')
    }
  }, [storyId])

  // Send a message
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming || !characterId) return

    setInput('')
    setError(null)

    const userMessage: ChatMessage = { role: 'user', content: text }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)

    // Add placeholder assistant message
    const emptyAssistant: AssistantMessage = { role: 'assistant', content: '' }
    setMessages([...updatedMessages, emptyAssistant])
    setIsStreaming(true)

    try {
      // Create conversation on first message if needed
      let activeConvId = conversationId
      if (!activeConvId) {
        const conv = await api.characterChat.createConversation(storyId, {
          characterId,
          persona,
          storyPointFragmentId: storyPointId,
        })
        activeConvId = conv.id
        setConversationId(conv.id)
      }

      // Build API messages (text only)
      const apiMessages = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const stream = await api.characterChat.chat(storyId, activeConvId, apiMessages)
      const reader = stream.getReader()

      let currentAssistant: AssistantMessage = { role: 'assistant', content: '' }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const event: ChatEvent = value

        switch (event.type) {
          case 'text':
            currentAssistant = {
              ...currentAssistant,
              content: currentAssistant.content + (event.text ?? ''),
            }
            break
          case 'reasoning':
            currentAssistant = {
              ...currentAssistant,
              reasoning: (currentAssistant.reasoning ?? '') + (event.text ?? ''),
            }
            break
          case 'tool-call': {
            const existing = currentAssistant.toolCalls ?? []
            currentAssistant = {
              ...currentAssistant,
              toolCalls: [...existing, { id: event.id, toolName: event.toolName, args: event.args ?? {} }],
            }
            break
          }
          case 'tool-result': {
            const calls = currentAssistant.toolCalls ?? []
            currentAssistant = {
              ...currentAssistant,
              toolCalls: calls.map((tc) =>
                tc.id === event.id ? { ...tc, result: event.result } : tc,
              ),
            }
            break
          }
          case 'finish':
            break
        }

        setMessages([...updatedMessages, currentAssistant])
      }

      setMessages([...updatedMessages, currentAssistant])

      // Invalidate conversation list
      await queryClient.invalidateQueries({ queryKey: ['character-chat-conversations', storyId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat failed')
      setMessages(updatedMessages)
    } finally {
      setIsStreaming(false)
      textareaRef.current?.focus()
    }
  }, [input, isStreaming, characterId, messages, conversationId, storyId, persona, storyPointId, queryClient])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="flex flex-col h-full relative" data-component-id="character-chat-view">
      {/* Config bar */}
      <ChatConfig
        characters={characters}
        selectedCharacterId={characterId}
        onCharacterChange={handleCharacterChange}
        persona={persona}
        onPersonaChange={setPersona}
        proseChain={proseChain ?? null}
        proseFragments={proseFragments}
        storyPointId={storyPointId}
        onStoryPointChange={setStoryPointId}
        onShowConversations={() => setShowConversations(true)}
        onClose={onClose}
        disabled={isStreaming}
        mediaById={mediaById}
      />

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0" data-component-id="character-chat-scroll">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          {/* Empty state */}
          {messages.length === 0 && selectedCharacter && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
              <CharacterAvatar character={selectedCharacter} mediaById={mediaById} size="lg" />
              <div>
                <h3 className="font-display text-xl tracking-tight mb-1">
                  {selectedCharacter.name}
                </h3>
                <p className="text-xs text-muted-foreground/40 italic max-w-[280px]">
                  {selectedCharacter.description}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground/25 max-w-[240px] leading-relaxed">
                Start a conversation. The character will respond in their voice, knowing only the story events up to your selected point.
              </p>
            </div>
          )}

          {/* No character selected */}
          {messages.length === 0 && !selectedCharacter && characters.length > 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-xs text-muted-foreground/40 italic">
                Select a character to begin.
              </p>
            </div>
          )}

          {/* No characters in story */}
          {characters.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-xs text-muted-foreground/40 italic max-w-[240px]">
                Create character fragments in your story first, then return here to chat with them.
              </p>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg, i) => {
            const isFirstAssistantInGroup = msg.role === 'assistant' && (i === 1 || (i > 0 && messages[i - 1]?.role === 'user'))
            return (
              <div
                key={`${msg.role}-${i}`}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${
                  isFirstAssistantInGroup ? 'items-start gap-2.5' : msg.role === 'assistant' ? 'pl-[34px]' : ''
                }`}
              >
                {isFirstAssistantInGroup && selectedCharacter && (
                  <CharacterAvatar character={selectedCharacter} mediaById={mediaById} size="sm" />
                )}
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-2.5 text-[13px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary/8 text-foreground'
                      : 'bg-card/60 border border-border/20 text-foreground/85'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div>
                      {isFirstAssistantInGroup && (
                        <div className="font-display text-[11px] text-primary/50 mb-1 tracking-wide">
                          {selectedCharacter?.name}
                        </div>
                      )}
                      <div className="font-prose">
                        <AssistantMessageView
                          msg={msg}
                          streaming={isStreaming && i === messages.length - 1}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="break-words whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>
              </div>
            )
          })}

          {error && (
            <div className="text-xs text-destructive bg-destructive/5 rounded-lg p-3">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border/20 bg-card/20">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedCharacter
                  ? `Say something to ${selectedCharacter.name}...`
                  : 'Select a character first...'
              }
              disabled={isStreaming || !characterId}
              className="min-h-[44px] max-h-[140px] resize-none text-[13px] bg-transparent
                placeholder:italic placeholder:text-muted-foreground/30 flex-1 border-border/30
                focus-visible:ring-primary/20"
              rows={1}
              data-component-id="character-chat-input"
            />
            <Button
              size="icon"
              className="size-9 shrink-0"
              disabled={!input.trim() || isStreaming || !characterId}
              onClick={handleSend}
              data-component-id="character-chat-send"
            >
              {isStreaming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground/20 text-center mt-2">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>

      {/* Conversation list overlay */}
      {showConversations && (
        <ConversationList
          storyId={storyId}
          characterId={characterId}
          characters={characters}
          mediaById={mediaById}
          onSelect={resumeConversation}
          onNew={startNewConversation}
          onClose={() => setShowConversations(false)}
        />
      )}
    </div>
  )
}
