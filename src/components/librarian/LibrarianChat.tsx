import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ChatEvent } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, Trash2, Loader2 } from 'lucide-react'
import {
  AssistantMessageView,
  type AssistantMessage,
  type ChatMessage,
} from '@/components/chat/ChatMessageParts'

interface LibrarianChatProps {
  storyId: string
  initialInput?: string
}

export function LibrarianChat({ storyId, initialInput }: LibrarianChatProps) {
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const initialInputAppliedRef = useRef<string | null>(null)

  // Apply initial input when it changes or when component becomes visible
  useEffect(() => {
    if (initialInput && initialInput !== initialInputAppliedRef.current) {
      setInput(initialInput)
      initialInputAppliedRef.current = initialInput
      // Focus the textarea after setting input
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 0)
    }
  })

  // Load persisted chat history on mount
  const { data: chatHistory } = useQuery({
    queryKey: ['librarian-chat-history', storyId],
    queryFn: () => api.librarian.getChatHistory(storyId),
    staleTime: Infinity,
  })

  useEffect(() => {
    if (chatHistory && !loaded && !isStreaming) {
      if (chatHistory.messages.length > 0) {
        setMessages(chatHistory.messages.map(m => {
          if (m.role === 'assistant') {
            return {
              role: 'assistant' as const,
              content: m.content,
              ...(m.reasoning ? { reasoning: m.reasoning } : {}),
            }
          }
          return m
        }))
      }
      setLoaded(true)
    }
  }, [chatHistory, loaded, isStreaming])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput('')
    setError(null)

    const userMessage: ChatMessage = { role: 'user', content: text }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)

    // Add placeholder assistant message for streaming
    const emptyAssistant: AssistantMessage = { role: 'assistant', content: '' }
    setMessages([...updatedMessages, emptyAssistant])
    setIsStreaming(true)

    try {
      // Send only text content for the API (history doesn't include tool calls)
      const apiMessages = updatedMessages.map(m => ({
        role: m.role,
        content: m.content,
      }))

      const stream = await api.librarian.chat(storyId, apiMessages)
      const reader = stream.getReader()

      let currentAssistant: AssistantMessage = { role: 'assistant', content: '' }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const event: ChatEvent = value

        switch (event.type) {
          case 'text':
            currentAssistant = { ...currentAssistant, content: currentAssistant.content + (event.text ?? '') }
            break
          case 'reasoning':
            currentAssistant = {
              ...currentAssistant,
              reasoning: (currentAssistant.reasoning ?? '') + (event.text ?? ''),
            }
            break
          case 'tool-call': {
            const existingCalls = currentAssistant.toolCalls ?? []
            currentAssistant = {
              ...currentAssistant,
              toolCalls: [...existingCalls, { id: event.id, toolName: event.toolName, args: event.args ?? {} }],
            }
            break
          }
          case 'tool-result': {
            const calls = currentAssistant.toolCalls ?? []
            currentAssistant = {
              ...currentAssistant,
              toolCalls: calls.map(tc =>
                tc.id === event.id ? { ...tc, result: event.result } : tc
              ),
            }
            break
          }
          case 'finish':
            // Stream done
            break
        }

        setMessages([...updatedMessages, currentAssistant])
      }

      setMessages([...updatedMessages, currentAssistant])

      // Invalidate fragment queries so sidebar lists update
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['librarian-chat-history', storyId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat failed')
      // Remove the empty assistant message on error
      setMessages(updatedMessages)
    } finally {
      setIsStreaming(false)
      textareaRef.current?.focus()
    }
  }, [input, isStreaming, messages, storyId, queryClient])

  const handleClear = useCallback(async () => {
    setMessages([])
    setError(null)
    setInput('')
    textareaRef.current?.focus()
    // Clear persisted history
    try {
      await api.librarian.clearChatHistory(storyId)
      await queryClient.invalidateQueries({ queryKey: ['librarian-chat-history', storyId] })
    } catch {
      // Ignore errors on clear
    }
  }, [storyId, queryClient])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="flex flex-col h-full" data-component-id="librarian-chat-root">
      {/* Messages area */}
      <ScrollArea className="flex-1 min-h-0" data-component-id="librarian-chat-scroll">
        <div className="p-3 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center" data-component-id="librarian-chat-empty">
              <p className="text-xs text-muted-foreground/40 italic max-w-[240px]">
                Ask the librarian to make changes across your story — update characters, adjust guidelines, or reshape knowledge.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={`${msg.role}-${i}`}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                  msg.role === 'user'
                    ? 'bg-primary/10 text-foreground'
                    : 'bg-card/50 border border-border/30 text-foreground/80'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <AssistantMessageView
                    msg={msg}
                    streaming={isStreaming && i === messages.length - 1}
                  />
                ) : (
                  <div className="break-words whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
            </div>
          ))}

          {error && (
            <div className="text-xs text-destructive bg-destructive/5 rounded-md p-2">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t border-border/30 p-3 space-y-2">
        {messages.length > 0 && !isStreaming && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] gap-1 text-muted-foreground/50 hover:text-muted-foreground"
              onClick={handleClear}
              data-component-id="librarian-chat-clear"
            >
              <Trash2 className="size-3" />
              Clear
            </Button>
          </div>
        )}

        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the librarian..."
            disabled={isStreaming}
            className="min-h-[40px] max-h-[120px] resize-none text-xs bg-transparent placeholder:italic placeholder:text-muted-foreground/40 flex-1"
            rows={1}
            data-component-id="librarian-chat-input"
          />
          <Button
            size="icon"
            className="size-8 shrink-0"
            disabled={!input.trim() || isStreaming}
            onClick={handleSend}
            data-component-id="librarian-chat-send"
          >
            {isStreaming ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground/30 text-center">
          Enter to send, Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}
