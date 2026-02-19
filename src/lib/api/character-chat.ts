import { apiFetch, fetchEventStream } from './client'
import type {
  CharacterChatConversation,
  CharacterChatConversationSummary,
  PersonaMode,
} from './types'

export const characterChat = {
  listConversations: (storyId: string, characterId?: string) => {
    const query = characterId ? `?characterId=${encodeURIComponent(characterId)}` : ''
    return apiFetch<CharacterChatConversationSummary[]>(
      `/stories/${storyId}/character-chat/conversations${query}`,
    )
  },

  getConversation: (storyId: string, conversationId: string) =>
    apiFetch<CharacterChatConversation>(
      `/stories/${storyId}/character-chat/conversations/${conversationId}`,
    ),

  createConversation: (
    storyId: string,
    opts: {
      characterId: string
      persona: PersonaMode
      storyPointFragmentId?: string | null
      title?: string
    },
  ) =>
    apiFetch<CharacterChatConversation>(
      `/stories/${storyId}/character-chat/conversations`,
      {
        method: 'POST',
        body: JSON.stringify(opts),
      },
    ),

  deleteConversation: (storyId: string, conversationId: string) =>
    apiFetch<{ ok: boolean }>(
      `/stories/${storyId}/character-chat/conversations/${conversationId}`,
      { method: 'DELETE' },
    ),

  chat: (
    storyId: string,
    conversationId: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) =>
    fetchEventStream(
      `/stories/${storyId}/character-chat/conversations/${conversationId}/chat`,
      { messages },
    ),
}
