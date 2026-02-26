import { Elysia, t } from 'elysia'
import { getStory, getFragment } from '../fragments/storage'
import {
  getGenerationLog,
  listGenerationLogs,
} from '../llm/generation-logs'
import { getLibrarianRuntimeStatus } from '../librarian/scheduler'
import { createSSEStream } from '../librarian/analysis-stream'
import { createAgentInstance, listAgentRuns } from '../agents'
import {
  getState as getLibrarianState,
  listAnalyses as listLibrarianAnalyses,
  getAnalysis as getLibrarianAnalysis,
  saveAnalysis as saveLibrarianAnalysis,
  getChatHistory as getLibrarianChatHistory,
  saveChatHistory as saveLibrarianChatHistory,
  clearChatHistory as clearLibrarianChatHistory,
  listConversations,
  createConversation,
  deleteConversation,
  getConversationHistory,
  saveConversationHistory,
} from '../librarian/storage'
import { applyFragmentSuggestion } from '../librarian/suggestions'
import { createLogger } from '../logging'
import { encodeStream } from './encode-stream'

export function librarianRoutes(dataDir: string) {
  const logger = createLogger('api:librarian', { dataDir })

  return new Elysia({ detail: { tags: ['Librarian'] } })
    // --- Generation Logs ---
    .get('/stories/:storyId/generation-logs', async ({ params }) => {
      return listGenerationLogs(dataDir, params.storyId)
    }, { detail: { summary: 'List generation logs' } })

    .get('/stories/:storyId/generation-logs/:logId', async ({ params, set }) => {
      const log = await getGenerationLog(dataDir, params.storyId, params.logId)
      if (!log) {
        set.status = 404
        return { error: 'Generation log not found' }
      }
      return log
    }, { detail: { summary: 'Get a generation log by ID' } })

    // --- Librarian ---
    .get('/stories/:storyId/librarian/status', async ({ params }) => {
      const state = await getLibrarianState(dataDir, params.storyId)
      const runtime = getLibrarianRuntimeStatus(params.storyId)
      return {
        ...state,
        ...runtime,
      }
    }, { detail: { summary: 'Get librarian status' } })

    .get('/stories/:storyId/librarian/analysis-stream', async ({ params, set }) => {
      const stream = createSSEStream(params.storyId)
      if (!stream) {
        set.status = 404
        return { error: 'No active analysis' }
      }
      return new Response(encodeStream(stream), {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
      })
    }, { detail: { summary: 'Stream live analysis events (NDJSON)' } })

    .get('/stories/:storyId/librarian/analyses', async ({ params }) => {
      return listLibrarianAnalyses(dataDir, params.storyId)
    }, { detail: { summary: 'List all analyses' } })

    .get('/stories/:storyId/librarian/agent-runs', async ({ params }) => {
      return listAgentRuns(params.storyId)
    }, { detail: { summary: 'List agent runs' } })

    .get('/stories/:storyId/librarian/analyses/:analysisId', async ({ params, set }) => {
      const analysis = await getLibrarianAnalysis(dataDir, params.storyId, params.analysisId)
      if (!analysis) {
        set.status = 404
        return { error: 'Analysis not found' }
      }
      return analysis
    }, { detail: { summary: 'Get an analysis by ID' } })

    .post('/stories/:storyId/librarian/analyses/:analysisId/suggestions/:index/accept', async ({ params, set }) => {
      const analysis = await getLibrarianAnalysis(dataDir, params.storyId, params.analysisId)
      if (!analysis) {
        set.status = 404
        return { error: 'Analysis not found' }
      }
      const index = parseInt(params.index, 10)
      if (isNaN(index) || index < 0 || index >= analysis.fragmentSuggestions.length) {
        set.status = 422
        return { error: 'Invalid suggestion index' }
      }

      const result = await applyFragmentSuggestion({
        dataDir,
        storyId: params.storyId,
        analysis,
        suggestionIndex: index,
        reason: 'manual-accept',
      })

      analysis.fragmentSuggestions[index].accepted = true
      analysis.fragmentSuggestions[index].autoApplied = false
      analysis.fragmentSuggestions[index].createdFragmentId = result.fragmentId
      await saveLibrarianAnalysis(dataDir, params.storyId, analysis)
      return {
        analysis,
        createdFragmentId: result.fragmentId,
      }
    }, { detail: { summary: 'Accept a fragment suggestion' } })

    // --- Librarian Refine ---
    .post('/stories/:storyId/librarian/refine', async ({ params, body, set }) => {
      const requestLogger = logger.child({ storyId: params.storyId })
      requestLogger.info('Refinement request started', { fragmentId: body.fragmentId })

      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const fragment = await getFragment(dataDir, params.storyId, body.fragmentId)
      if (!fragment) {
        set.status = 404
        return { error: 'Fragment not found' }
      }

      if (fragment.type === 'prose') {
        set.status = 422
        return { error: 'Cannot refine prose fragments. Use the generation refine mode instead.' }
      }

      try {
        const agent = createAgentInstance('librarian.refine', { dataDir, storyId: params.storyId })
        const { eventStream, completion } = await agent.execute({
          fragmentId: body.fragmentId,
          instructions: body.instructions,
          maxSteps: story.settings.maxSteps ?? 5,
        })

        completion.then((result) => {
          requestLogger.info('Refinement completed', {
            fragmentId: body.fragmentId,
            stepCount: result.stepCount,
            finishReason: result.finishReason,
            toolCallCount: result.toolCalls.length,
          })
        }).catch((err) => {
          requestLogger.error('Refinement completion error', { error: err instanceof Error ? err.message : String(err) })
        })

        return new Response(encodeStream(eventStream), {
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        })
      } catch (err) {
        requestLogger.error('Refinement failed', { error: err instanceof Error ? err.message : String(err) })
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Refinement failed' }
      }
    }, {
      body: t.Object({
        fragmentId: t.String(),
        instructions: t.Optional(t.String()),
      }),
      detail: { summary: 'Refine a non-prose fragment (streaming NDJSON)' },
    })

    // --- Librarian Prose Transform ---
    .post('/stories/:storyId/librarian/prose-transform', async ({ params, body, set }) => {
      const requestLogger = logger.child({ storyId: params.storyId })
      requestLogger.info('Prose transform request started', {
        fragmentId: body.fragmentId,
        operation: body.operation,
      })

      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const fragment = await getFragment(dataDir, params.storyId, body.fragmentId)
      if (!fragment) {
        set.status = 404
        return { error: 'Fragment not found' }
      }

      if (fragment.type !== 'prose') {
        set.status = 422
        return { error: 'Only prose fragments support selection transforms.' }
      }

      try {
        const agent = createAgentInstance('librarian.prose-transform', { dataDir, storyId: params.storyId })
        const { eventStream, completion } = await agent.execute({
          fragmentId: body.fragmentId,
          selectedText: body.selectedText,
          operation: body.operation,
          instruction: body.instruction,
          sourceContent: body.sourceContent,
          contextBefore: body.contextBefore,
          contextAfter: body.contextAfter,
        })

        completion.then((result) => {
          requestLogger.info('Prose transform completed', {
            fragmentId: body.fragmentId,
            operation: body.operation,
            stepCount: result.stepCount,
            finishReason: result.finishReason,
            outputLength: result.text.trim().length,
            reasoningLength: result.reasoning.trim().length,
          })
        }).catch((err) => {
          requestLogger.error('Prose transform completion error', {
            error: err instanceof Error ? err.message : String(err),
          })
        })

        return new Response(encodeStream(eventStream), {
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        })
      } catch (err) {
        requestLogger.error('Prose transform failed', { error: err instanceof Error ? err.message : String(err) })
        set.status = 500
        return { error: err instanceof Error ? err.message : 'Prose transform failed' }
      }
    }, {
      body: t.Object({
        fragmentId: t.String(),
        selectedText: t.String({ minLength: 1 }),
        operation: t.Union([t.Literal('rewrite'), t.Literal('expand'), t.Literal('compress'), t.Literal('custom')]),
        instruction: t.Optional(t.String()),
        sourceContent: t.Optional(t.String()),
        contextBefore: t.Optional(t.String()),
        contextAfter: t.Optional(t.String()),
      }),
      detail: { summary: 'Transform a prose selection (streaming NDJSON)' },
    })

    // --- Librarian Chat ---
    .get('/stories/:storyId/librarian/chat', async ({ params }) => {
      return getLibrarianChatHistory(dataDir, params.storyId)
    }, { detail: { summary: 'Get chat history' } })

    .delete('/stories/:storyId/librarian/chat', async ({ params }) => {
      await clearLibrarianChatHistory(dataDir, params.storyId)
      return { ok: true }
    }, { detail: { summary: 'Clear chat history' } })

    .post('/stories/:storyId/librarian/chat', async ({ params, body, set }) => {
      const requestLogger = logger.child({ storyId: params.storyId })
      requestLogger.info('Librarian chat request', { messageCount: body.messages.length })

      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      if (!body.messages.length) {
        set.status = 422
        return { error: 'At least one message is required' }
      }

      try {
        const agent = createAgentInstance('librarian.chat', { dataDir, storyId: params.storyId })
        const { eventStream, completion } = await agent.execute({
          messages: body.messages,
          maxSteps: story.settings.maxSteps ?? 10,
        })

        // Persist chat history after completion (in background)
        completion.then(async (result) => {
          requestLogger.info('Librarian chat completed', {
            stepCount: result.stepCount,
            finishReason: result.finishReason,
            toolCallCount: result.toolCalls.length,
          })
          const fullHistory = [
            ...body.messages,
            {
              role: 'assistant' as const,
              content: result.text,
              ...(result.reasoning ? { reasoning: result.reasoning } : {}),
            },
          ]
          await saveLibrarianChatHistory(dataDir, params.storyId, fullHistory)
        }).catch((err) => {
          requestLogger.error('Librarian chat completion error', { error: err instanceof Error ? err.message : String(err) })
        })

        return new Response(encodeStream(eventStream), {
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        })
      } catch (err) {
        requestLogger.error('Librarian chat failed', { error: err instanceof Error ? err.message : String(err) })
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
      detail: { summary: 'Chat with the librarian (streaming NDJSON)' },
    })

    // --- Conversations ---
    .get('/stories/:storyId/librarian/conversations', async ({ params }) => {
      return listConversations(dataDir, params.storyId)
    }, { detail: { summary: 'List chat conversations' } })

    .post('/stories/:storyId/librarian/conversations', async ({ params, body }) => {
      return createConversation(dataDir, params.storyId, body.title ?? 'New chat')
    }, {
      body: t.Object({ title: t.Optional(t.String()) }),
      detail: { summary: 'Create a chat conversation' },
    })

    .delete('/stories/:storyId/librarian/conversations/:conversationId', async ({ params, set }) => {
      const ok = await deleteConversation(dataDir, params.storyId, params.conversationId)
      if (!ok) { set.status = 404; return { error: 'Conversation not found' } }
      return { ok: true }
    }, { detail: { summary: 'Delete a conversation' } })

    .get('/stories/:storyId/librarian/conversations/:conversationId/chat', async ({ params }) => {
      return getConversationHistory(dataDir, params.storyId, params.conversationId)
    }, { detail: { summary: 'Get conversation chat history' } })

    .post('/stories/:storyId/librarian/conversations/:conversationId/chat', async ({ params, body, set }) => {
      const requestLogger = logger.child({ storyId: params.storyId, extra: { conversationId: params.conversationId } })
      requestLogger.info('Conversation chat request', { messageCount: body.messages.length })

      const story = await getStory(dataDir, params.storyId)
      if (!story) { set.status = 404; return { error: 'Story not found' } }
      if (!body.messages.length) { set.status = 422; return { error: 'At least one message is required' } }

      try {
        const agent = createAgentInstance('librarian.chat', { dataDir, storyId: params.storyId })
        const { eventStream, completion } = await agent.execute({
          messages: body.messages,
          maxSteps: story.settings.maxSteps ?? 10,
        })

        completion.then(async (result) => {
          requestLogger.info('Conversation chat completed', {
            stepCount: result.stepCount,
            finishReason: result.finishReason,
            toolCallCount: result.toolCalls.length,
          })
          const fullHistory = [
            ...body.messages,
            {
              role: 'assistant' as const,
              content: result.text,
              ...(result.reasoning ? { reasoning: result.reasoning } : {}),
            },
          ]
          await saveConversationHistory(dataDir, params.storyId, params.conversationId, fullHistory)
        }).catch((err) => {
          requestLogger.error('Conversation chat completion error', { error: err instanceof Error ? err.message : String(err) })
        })

        return new Response(encodeStream(eventStream), {
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        })
      } catch (err) {
        requestLogger.error('Conversation chat failed', { error: err instanceof Error ? err.message : String(err) })
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
      detail: { summary: 'Chat in a conversation (streaming NDJSON)' },
    })
}
