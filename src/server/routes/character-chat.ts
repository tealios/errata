import { Elysia, t } from 'elysia'
import { getStory, getFragment } from '../fragments/storage'
import { invokeAgent } from '../agents'
import {
  saveConversation as saveCharacterConversation,
  getConversation as getCharacterConversation,
  listConversations as listCharacterConversations,
  deleteConversation as deleteCharacterConversation,
  generateConversationId,
  type CharacterChatConversation,
} from '../character-chat/storage'
import { createLogger } from '../logging'
import { encodeStream } from './encode-stream'
import type { ChatResult as CharacterChatResult } from '../character-chat/chat'

export function characterChatRoutes(dataDir: string) {
  const logger = createLogger('api:character-chat', { dataDir })

  return new Elysia()
    .get('/stories/:storyId/character-chat/conversations', async ({ params, query }) => {
      const characterId = typeof query?.characterId === 'string' ? query.characterId : undefined
      return listCharacterConversations(dataDir, params.storyId, characterId)
    })

    .get('/stories/:storyId/character-chat/conversations/:conversationId', async ({ params, set }) => {
      const conv = await getCharacterConversation(dataDir, params.storyId, params.conversationId)
      if (!conv) {
        set.status = 404
        return { error: 'Conversation not found' }
      }
      return conv
    })

    .post('/stories/:storyId/character-chat/conversations', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const character = await getFragment(dataDir, params.storyId, body.characterId)
      if (!character || character.type !== 'character') {
        set.status = 404
        return { error: 'Character not found' }
      }

      const now = new Date().toISOString()
      const conv: CharacterChatConversation = {
        id: generateConversationId(),
        characterId: body.characterId,
        persona: body.persona,
        storyPointFragmentId: body.storyPointFragmentId ?? null,
        title: body.title || `Chat with ${character.name}`,
        messages: [],
        createdAt: now,
        updatedAt: now,
      }
      await saveCharacterConversation(dataDir, params.storyId, conv)
      return conv
    }, {
      body: t.Object({
        characterId: t.String(),
        persona: t.Union([
          t.Object({ type: t.Literal('character'), characterId: t.String() }),
          t.Object({ type: t.Literal('stranger') }),
          t.Object({ type: t.Literal('custom'), prompt: t.String() }),
        ]),
        storyPointFragmentId: t.Optional(t.Union([t.String(), t.Null()])),
        title: t.Optional(t.String()),
      }),
    })

    .delete('/stories/:storyId/character-chat/conversations/:conversationId', async ({ params, set }) => {
      const deleted = await deleteCharacterConversation(dataDir, params.storyId, params.conversationId)
      if (!deleted) {
        set.status = 404
        return { error: 'Conversation not found' }
      }
      return { ok: true }
    })

    .post('/stories/:storyId/character-chat/conversations/:conversationId/chat', async ({ params, body, set }) => {
      const requestLogger = logger.child({ storyId: params.storyId, extra: { conversationId: params.conversationId } })
      requestLogger.info('Character chat request', { messageCount: body.messages.length })

      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const conv = await getCharacterConversation(dataDir, params.storyId, params.conversationId)
      if (!conv) {
        set.status = 404
        return { error: 'Conversation not found' }
      }

      if (!body.messages.length) {
        set.status = 422
        return { error: 'At least one message is required' }
      }

      try {
        const { output: chatOutput, trace } = await invokeAgent({
          dataDir,
          storyId: params.storyId,
          agentName: 'character-chat.chat',
          input: {
            characterId: conv.characterId,
            persona: conv.persona,
            storyPointFragmentId: conv.storyPointFragmentId,
            messages: body.messages,
            maxSteps: story.settings.maxSteps ?? 10,
          },
        })

        const { eventStream, completion } = chatOutput as CharacterChatResult
        requestLogger.info('Agent trace (character-chat)', { trace })

        // Persist conversation after completion (in background)
        completion.then(async (result) => {
          requestLogger.info('Character chat completed', {
            stepCount: result.stepCount,
            finishReason: result.finishReason,
            toolCallCount: result.toolCalls.length,
          })
          const now = new Date().toISOString()
          const updatedConv: CharacterChatConversation = {
            ...conv,
            messages: [
              ...body.messages.map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
                createdAt: now,
              })),
              {
                role: 'assistant' as const,
                content: result.text,
                ...(result.reasoning ? { reasoning: result.reasoning } : {}),
                createdAt: now,
              },
            ],
            updatedAt: now,
          }
          await saveCharacterConversation(dataDir, params.storyId, updatedConv)
        }).catch((err) => {
          requestLogger.error('Character chat completion error', { error: err instanceof Error ? err.message : String(err) })
        })

        return new Response(encodeStream(eventStream), {
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        })
      } catch (err) {
        requestLogger.error('Character chat failed', { error: err instanceof Error ? err.message : String(err) })
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Chat failed' }
      }
    }, {
      body: t.Object({
        messages: t.Array(t.Object({
          role: t.Union([t.Literal('user'), t.Literal('assistant')]),
          content: t.String(),
        })),
      }),
    })
}
