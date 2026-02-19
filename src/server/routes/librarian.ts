import { Elysia, t } from 'elysia'
import { getStory, getFragment } from '../fragments/storage'
import {
  saveGenerationLog,
  getGenerationLog,
  listGenerationLogs,
} from '../llm/generation-logs'
import { triggerLibrarian, getLibrarianRuntimeStatus } from '../librarian/scheduler'
import { createSSEStream } from '../librarian/analysis-stream'
import { invokeAgent, listAgentRuns } from '../agents'
import {
  getState as getLibrarianState,
  listAnalyses as listLibrarianAnalyses,
  getAnalysis as getLibrarianAnalysis,
  saveAnalysis as saveLibrarianAnalysis,
  getChatHistory as getLibrarianChatHistory,
  saveChatHistory as saveLibrarianChatHistory,
  clearChatHistory as clearLibrarianChatHistory,
} from '../librarian/storage'
import { applyKnowledgeSuggestion } from '../librarian/suggestions'
import { createLogger } from '../logging'
import { encodeStream } from './encode-stream'
import type { RefineResult } from '../librarian/refine'
import type { ChatResult } from '../librarian/chat'
import type { ProseTransformResult } from '../librarian/prose-transform'

export function librarianRoutes(dataDir: string) {
  const logger = createLogger('api:librarian', { dataDir })

  return new Elysia()
    // --- Generation Logs ---
    .get('/stories/:storyId/generation-logs', async ({ params }) => {
      return listGenerationLogs(dataDir, params.storyId)
    })

    .get('/stories/:storyId/generation-logs/:logId', async ({ params, set }) => {
      const log = await getGenerationLog(dataDir, params.storyId, params.logId)
      if (!log) {
        set.status = 404
        return { error: 'Generation log not found' }
      }
      return log
    })

    // --- Librarian ---
    .get('/stories/:storyId/librarian/status', async ({ params }) => {
      const state = await getLibrarianState(dataDir, params.storyId)
      const runtime = getLibrarianRuntimeStatus(params.storyId)
      return {
        ...state,
        ...runtime,
      }
    })

    .get('/stories/:storyId/librarian/analysis-stream', async ({ params, set }) => {
      const stream = createSSEStream(params.storyId)
      if (!stream) {
        set.status = 404
        return { error: 'No active analysis' }
      }
      return new Response(encodeStream(stream), {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
      })
    })

    .get('/stories/:storyId/librarian/analyses', async ({ params }) => {
      return listLibrarianAnalyses(dataDir, params.storyId)
    })

    .get('/stories/:storyId/librarian/agent-runs', async ({ params }) => {
      return listAgentRuns(params.storyId)
    })

    .get('/stories/:storyId/librarian/analyses/:analysisId', async ({ params, set }) => {
      const analysis = await getLibrarianAnalysis(dataDir, params.storyId, params.analysisId)
      if (!analysis) {
        set.status = 404
        return { error: 'Analysis not found' }
      }
      return analysis
    })

    .post('/stories/:storyId/librarian/analyses/:analysisId/suggestions/:index/accept', async ({ params, set }) => {
      const analysis = await getLibrarianAnalysis(dataDir, params.storyId, params.analysisId)
      if (!analysis) {
        set.status = 404
        return { error: 'Analysis not found' }
      }
      const index = parseInt(params.index, 10)
      if (isNaN(index) || index < 0 || index >= analysis.knowledgeSuggestions.length) {
        set.status = 422
        return { error: 'Invalid suggestion index' }
      }

      const result = await applyKnowledgeSuggestion({
        dataDir,
        storyId: params.storyId,
        analysis,
        suggestionIndex: index,
        reason: 'manual-accept',
      })

      analysis.knowledgeSuggestions[index].accepted = true
      analysis.knowledgeSuggestions[index].autoApplied = false
      analysis.knowledgeSuggestions[index].createdFragmentId = result.fragmentId
      await saveLibrarianAnalysis(dataDir, params.storyId, analysis)
      return {
        analysis,
        createdFragmentId: result.fragmentId,
      }
    })

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
        const { output: refineOutput, trace } = await invokeAgent({
          dataDir,
          storyId: params.storyId,
          agentName: 'librarian.refine',
          input: {
            fragmentId: body.fragmentId,
            instructions: body.instructions,
            maxSteps: story.settings.maxSteps ?? 5,
          },
        })

        const { textStream, completion } = refineOutput as RefineResult
        requestLogger.info('Agent trace (refine)', { trace })

        // Log completion in background
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

        return new Response(encodeStream(textStream), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
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
        const { output: transformOutput, trace } = await invokeAgent({
          dataDir,
          storyId: params.storyId,
          agentName: 'librarian.prose-transform',
          input: {
            fragmentId: body.fragmentId,
            selectedText: body.selectedText,
            operation: body.operation,
            instruction: body.instruction,
            sourceContent: body.sourceContent,
            contextBefore: body.contextBefore,
            contextAfter: body.contextAfter,
          },
        })

        const { eventStream, completion } = transformOutput as ProseTransformResult
        requestLogger.info('Agent trace (prose-transform)', { trace })

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
    })

    // --- Librarian Chat ---
    .get('/stories/:storyId/librarian/chat', async ({ params }) => {
      return getLibrarianChatHistory(dataDir, params.storyId)
    })

    .delete('/stories/:storyId/librarian/chat', async ({ params }) => {
      await clearLibrarianChatHistory(dataDir, params.storyId)
      return { ok: true }
    })

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
        const { output: chatOutput, trace } = await invokeAgent({
          dataDir,
          storyId: params.storyId,
          agentName: 'librarian.chat',
          input: {
            messages: body.messages,
            maxSteps: story.settings.maxSteps ?? 10,
          },
        })

        const { eventStream, completion } = chatOutput as ChatResult
        requestLogger.info('Agent trace (chat)', { trace })

        // Persist chat history after completion (in background)
        completion.then(async (result) => {
          requestLogger.info('Librarian chat completed', {
            stepCount: result.stepCount,
            finishReason: result.finishReason,
            toolCallCount: result.toolCalls.length,
          })
          // Save full conversation (user messages + assistant response)
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
    })
}
