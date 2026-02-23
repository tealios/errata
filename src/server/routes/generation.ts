import { Elysia, t } from 'elysia'
import {
  getStory,
  createFragment,
  getFragment,
  listFragments,
} from '../fragments/storage'
import {
  addProseSection,
  addProseVariation,
  findSectionIndex,
} from '../fragments/prose-chain'
import { generateFragmentId } from '@/lib/fragment-ids'
import { buildContextState, createDefaultBlocks, compileBlocks, addCacheBreakpoints } from '../llm/context-builder'
import { getBlockConfig } from '../blocks/storage'
import { applyBlockConfig } from '../blocks/apply'
import { createScriptHelpers } from '../blocks/script-context'
import { createFragmentTools } from '../llm/tools'
import { getModel } from '../llm/client'
import { createWriterAgent } from '../llm/writer-agent'
import { runPrewriter, createWriterBriefBlocks } from '../llm/prewriter'
import {
  saveGenerationLog,
  type GenerationLog,
  type ToolCallLog,
} from '../llm/generation-logs'
import { pluginRegistry } from '../plugins/registry'
import {
  runBeforeContext,
  runBeforeBlocks,
  runBeforeGeneration,
  runAfterGeneration,
  runAfterSave,
} from '../plugins/hooks'
import { collectPluginToolsWithOrigin } from '../plugins/tools'
import { triggerLibrarian } from '../librarian/scheduler'
import { getAgentBlockConfig } from '../agents/agent-block-storage'
import { invokeAgent } from '../agents/runner'
import { registerActiveAgent, unregisterActiveAgent } from '../agents/active-registry'
import { reportUsage } from '../llm/token-tracker'
import { createLogger } from '../logging'
import type { Fragment } from '../fragments/schema'
import type { SuggestDirectionsResult } from '../directions/suggest'

export function generationRoutes(dataDir: string) {
  const logger = createLogger('api:generation', { dataDir })

  return new Elysia()
    .post('/stories/:storyId/suggest-directions', async ({ params, body, set }) => {
      const requestLogger = logger.child({ storyId: params.storyId })
      requestLogger.info('Suggest directions request')

      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      try {
        const { output } = await invokeAgent<SuggestDirectionsResult>({
          dataDir,
          storyId: params.storyId,
          agentName: 'directions.suggest',
          input: { count: body.count },
        })
        return { suggestions: output.suggestions }
      } catch (err) {
        requestLogger.error('Suggest directions failed', { error: err instanceof Error ? err.message : String(err) })
        set.status = 502
        return { error: err instanceof Error ? err.message : 'Failed to generate suggestions' }
      }
    }, {
      body: t.Object({
        count: t.Optional(t.Number()),
      }),
    })
    .post('/stories/:storyId/generate', async ({ params, body, set }) => {
      const requestLogger = logger.child({ storyId: params.storyId })
      requestLogger.info('Generation request started', { mode: body.mode ?? 'generate', saveResult: body.saveResult ?? false })

      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        requestLogger.warn('Story not found', { storyId: params.storyId })
        set.status = 404
        return { error: 'Story not found' }
      }

      if (!body.input || body.input.trim() === '') {
        requestLogger.warn('Empty input received')
        set.status = 422
        return { error: 'Input is required' }
      }

      const mode = body.mode ?? 'generate'
      const modeLabel = mode === 'regenerate'
        ? 'Regenerate'
        : mode === 'refine'
          ? 'Refine'
          : 'Continuation'
      const proseFragmentName = `[${modeLabel}] ${body.input.trim()}`.slice(0, 100)

      // Validate fragmentId for regenerate/refine
      let existingFragment: Fragment | null = null
      if (mode === 'regenerate' || mode === 'refine') {
        if (!body.fragmentId) {
          requestLogger.warn('Missing fragmentId for regenerate/refine mode')
          set.status = 422
          return { error: 'fragmentId is required for regenerate/refine modes' }
        }
        existingFragment = await getFragment(dataDir, params.storyId, body.fragmentId)
        if (!existingFragment) {
          requestLogger.warn('Fragment not found', { fragmentId: body.fragmentId })
          set.status = 404
          return { error: 'Fragment not found' }
        }
      }

      // Compose prompt based on mode
      let effectiveInput = body.input
      if (mode === 'refine' && existingFragment) {
        effectiveInput = `Here is an existing prose passage (fragment ${existingFragment.id}):\n---\n${existingFragment.content}\n---\nRefine this passage: ${body.input}\nOutput only the rewritten prose.`
      }

      const startTime = Date.now()

      // Get enabled plugins
      const enabledPlugins = pluginRegistry.getEnabled(
        story.settings.enabledPlugins,
      )
      requestLogger.info('Plugins enabled', { pluginCount: enabledPlugins.length, plugins: enabledPlugins.map(p => p.manifest.name) })

      // Build context with plugin hooks
      // When regenerating/refining, exclude the fragment being replaced from context
      requestLogger.info('Building context...')
      const buildContextOpts = (mode === 'regenerate' || mode === 'refine') && existingFragment
        ? {
            excludeFragmentId: existingFragment.id,
            proseBeforeFragmentId: existingFragment.id,
            summaryBeforeFragmentId: existingFragment.id,
          }
        : {}
      let ctxState = await buildContextState(dataDir, params.storyId, effectiveInput, buildContextOpts)
      const contextFragments = {
        proseCount: ctxState.proseFragments.length,
        stickyGuidelines: ctxState.stickyGuidelines.length,
        stickyKnowledge: ctxState.stickyKnowledge.length,
        stickyCharacters: ctxState.stickyCharacters.length,
        guidelineShortlist: ctxState.guidelineShortlist.length,
        knowledgeShortlist: ctxState.knowledgeShortlist.length,
        characterShortlist: ctxState.characterShortlist.length,
      }
      requestLogger.info('Context state built', contextFragments)

      ctxState = await runBeforeContext(enabledPlugins, ctxState)
      requestLogger.info('BeforeContext hooks completed')

      // Resolve model early so modelId is available for instruction resolution
      const { model, modelId: resolvedModelId } = await getModel(dataDir, params.storyId)
      requestLogger.info('Resolved model', { resolvedModelId })
      ctxState.modelId = resolvedModelId

      // Merge fragment tools + plugin tools, then filter by agent block config
      const fragmentTools = createFragmentTools(dataDir, params.storyId, { readOnly: true })
      const { tools: pluginTools, origins: pluginToolOrigins } = collectPluginToolsWithOrigin(enabledPlugins, dataDir, params.storyId)
      const allTools = { ...fragmentTools, ...pluginTools }
      const agentConfig = await getAgentBlockConfig(dataDir, params.storyId, 'generation.writer')
      const disabledTools = new Set(agentConfig.disabledTools ?? [])
      const tools: Record<string, (typeof allTools)[string]> = {}
      for (const [name, t] of Object.entries(allTools)) {
        if (!disabledTools.has(name)) tools[name] = t
      }
      requestLogger.info('Tools prepared', { toolCount: Object.keys(tools).length })

      // Extract plugin tool descriptions for context (fragment tools are listed from registry)
      const extraTools = Object.entries(pluginTools).map(([name, t]) => ({
        name,
        description: (t as { description?: string }).description ?? '',
        pluginName: pluginToolOrigins[name],
      }))

      let blocks = createDefaultBlocks(ctxState, extraTools.length > 0 ? { extraTools } : undefined)
      const blockConfig = await getBlockConfig(dataDir, params.storyId)
      blocks = await applyBlockConfig(blocks, blockConfig, {
        ...ctxState,
        ...createScriptHelpers(dataDir, params.storyId),
      })
      blocks = await runBeforeBlocks(enabledPlugins, blocks)
      let messages = compileBlocks(blocks)
      messages = await runBeforeGeneration(enabledPlugins, messages)
      requestLogger.info('BeforeGeneration hooks completed', { messageCount: messages.length })

      // Prewriter phase: if enabled, run prewriter and replace messages with stripped context
      let prewriterBrief: string | undefined
      let prewriterReasoning: string | undefined
      let prewriterDurationMs: number | undefined
      let prewriterModel: string | undefined
      let prewriterUsage: { inputTokens: number; outputTokens: number } | undefined
      let prewriterLogMessages: Array<{ role: string; content: string }> | undefined
      let prewriterDirections: Array<{ pacing: string; title: string; description: string; instruction: string }> | undefined
      let logMessages = messages // messages saved to generation log — updated to writer context in prewriter mode
      const isPrewriterMode = story.settings.generationMode === 'prewriter'

      const modelMessages = addCacheBreakpoints(messages)

      requestLogger.info('Starting LLM stream...')
      const abortController = new AbortController()

      // Build tool description lines for reuse (same logic as context-builder createDefaultBlocks)
      const toolLinesList: string[] = []
      {
        const types = (await import('../fragments/registry')).registry.listTypes()
        for (const t of types) {
          if (t.llmTools === false) continue
          const cap = t.type.charAt(0).toUpperCase() + t.type.slice(1)
          const plural = ['prose', 'knowledge'].includes(t.type) ? cap : cap + 's'
          toolLinesList.push(`- get${cap}(id): Get full content of a ${t.type} fragment`)
          toolLinesList.push(`- list${plural}(): List all ${t.type} fragments`)
        }
        toolLinesList.push('- listFragmentTypes(): List all available fragment types')
        for (const t of extraTools) {
          toolLinesList.push(`- ${t.name}: ${t.description}`)
        }
      }

      let fullText = ''
      let fullReasoning = ''
      const toolCalls: ToolCallLog[] = []
      let lastFinishReason = 'unknown'
      let stepCount = 0
      let wasAborted = false

      // Completion promise resolved when the stream ends — used by save path
      let completionResolve: ((val: void) => void) | null = null
      if (body.saveResult) {
        new Promise<void>((resolve) => { completionResolve = resolve })
      }

      const genActivityId = registerActiveAgent(params.storyId, 'generation.writer')

      const eventStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder()
          const emit = (event: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
          }
          let totalUsagePromise: PromiseLike<{ inputTokens?: number; outputTokens?: number }> | undefined
          try {
            // Run prewriter inside the stream so events are streamed live
            let writerMessages = modelMessages
            let prewriterStepCount = 0
            if (isPrewriterMode) {
              emit({ type: 'phase', phase: 'prewriting' })

              const prewriterActivityId = registerActiveAgent(params.storyId, 'generation.prewriter')
              try {
                const configuredMax = story.settings.maxSteps ?? 10
                const prewriterMaxSteps = Math.max(1, Math.floor(configuredMax / 2))
                const prewriterResult = await runPrewriter({
                  dataDir,
                  storyId: params.storyId,
                  compiledMessages: messages,
                  authorInput: effectiveInput,
                  mode,
                  tools,
                  maxSteps: prewriterMaxSteps,
                  abortSignal: abortController.signal,
                  onEvent: (event) => {
                    if (event.type === 'text') {
                      emit({ type: 'prewriter-text', text: event.text })
                    } else {
                      emit(event)
                    }
                  },
                })
                prewriterBrief = prewriterResult.brief
                prewriterReasoning = prewriterResult.reasoning || undefined
                prewriterDurationMs = prewriterResult.durationMs
                prewriterModel = prewriterResult.model
                prewriterUsage = prewriterResult.usage
                prewriterLogMessages = prewriterResult.messages
                prewriterStepCount = prewriterResult.stepCount
                if (prewriterResult.directions.length > 0) {
                  prewriterDirections = prewriterResult.directions
                  emit({ type: 'prewriter-directions', directions: prewriterDirections })
                }
                requestLogger.info('Prewriter completed', { briefLength: prewriterBrief.length, durationMs: prewriterDurationMs, stepCount: prewriterStepCount, directionsCount: prewriterDirections?.length ?? 0 })

                // Build stripped writer context with only prose + brief + custom blocks
                const writerBlocks = createWriterBriefBlocks(ctxState.proseFragments, prewriterResult.brief, toolLinesList, resolvedModelId)

                // Carry over: generation custom blocks, system-placement fragments, guideline blocks,
                // and custom blocks from the prewriter's agent block config
                const carryOverBlocks = blocks.filter(b => b.source === 'custom' || b.id === 'system-fragments' || b.id.startsWith('gl-'))
                writerBlocks.push(...carryOverBlocks, ...prewriterResult.customBlocks)
                const writerCompiled = compileBlocks(writerBlocks)
                writerMessages = addCacheBreakpoints(writerCompiled)
                logMessages = writerCompiled
              } finally {
                unregisterActiveAgent(prewriterActivityId)
              }

              emit({ type: 'phase', phase: 'writing' })
            }

            const configuredMaxSteps = story.settings.maxSteps ?? 10
            const writerMaxSteps = isPrewriterMode
              ? Math.max(1, configuredMaxSteps - prewriterStepCount)
              : configuredMaxSteps
            const writerAgent = createWriterAgent({
              model,
              tools,
              maxSteps: writerMaxSteps,
            })
            const result = await writerAgent.stream({
              messages: writerMessages,
              abortSignal: abortController.signal,
            })
            totalUsagePromise = result.totalUsage
            const fullStream = result.fullStream

            for await (const part of fullStream) {
              let event: Record<string, unknown> | null = null
              const p = part as Record<string, unknown>

              switch (part.type) {
                case 'text-delta': {
                  const text = (p.text ?? '') as string
                  fullText += text
                  event = { type: 'text', text }
                  break
                }
                case 'reasoning-delta': {
                  const text = (p.text ?? '') as string
                  fullReasoning += text
                  event = { type: 'reasoning', text }
                  break
                }
                case 'tool-call': {
                  const input = (p.input ?? {}) as Record<string, unknown>
                  event = {
                    type: 'tool-call',
                    id: p.toolCallId as string,
                    toolName: p.toolName as string,
                    args: input,
                  }
                  break
                }
                case 'tool-result': {
                  const toolName = (p.toolName as string) ?? ''
                  toolCalls.push({
                    toolName,
                    args: {},
                    result: p.output,
                  })
                  event = {
                    type: 'tool-result',
                    id: p.toolCallId as string,
                    toolName,
                    result: p.output,
                  }
                  break
                }
                case 'finish':
                  lastFinishReason = (p.finishReason as string) ?? 'unknown'
                  stepCount++
                  break
              }

              if (event) {
                controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
              }
            }

            // Emit a final finish event
            controller.enqueue(encoder.encode(JSON.stringify({
              type: 'finish',
              finishReason: lastFinishReason,
              stepCount,
            }) + '\n'))
            controller.close()
          } catch (err) {
            wasAborted = abortController.signal.aborted
            if (wasAborted) {
              requestLogger.info('Generation aborted by client', { textLength: fullText.length })
              lastFinishReason = 'stop'
              try {
                controller.enqueue(encoder.encode(JSON.stringify({
                  type: 'finish',
                  finishReason: 'stop',
                  stepCount,
                  stopped: true,
                }) + '\n'))
                controller.close()
              } catch {
                // Controller may already be closed
              }
            } else {
              controller.error(err)
            }
          } finally {
            unregisterActiveAgent(genActivityId)
          }

          // Run save operation after stream completes (skip if aborted with no text)
          if (body.saveResult && !(wasAborted && !fullText.trim())) {
            try {
              const durationMs = Date.now() - startTime
              requestLogger.info('LLM generation completed', { durationMs, textLength: fullText.length })

              requestLogger.info('Tool calls extracted', { toolCallCount: toolCalls.length })

              // Run afterGeneration hooks
              let genResult = await runAfterGeneration(enabledPlugins, {
                text: fullText,
                fragmentId: (mode === 'regenerate' || mode === 'refine') ? body.fragmentId! : null,
                toolCalls,
              })
              requestLogger.info('AfterGeneration hooks completed')

              const now = new Date().toISOString()
              let savedFragmentId: string

              if ((mode === 'regenerate' || mode === 'refine') && existingFragment) {
                // Create a NEW fragment as a variation (don't overwrite)
                const id = generateFragmentId('prose')
                const fragment: Fragment = {
                  id,
                  type: 'prose',
                  name: proseFragmentName,
                  description: body.input.slice(0, 250),
                  content: genResult.text,
                  tags: [...existingFragment.tags],
                  refs: [...existingFragment.refs],
                  sticky: existingFragment.sticky,
                  placement: existingFragment.placement ?? 'user',
                  createdAt: now,
                  updatedAt: now,
                  order: existingFragment.order,
                  meta: {
                    ...existingFragment.meta,
                    generatedFrom: body.input,
                    generationMode: mode,
                    previousFragmentId: existingFragment.id,
                    variationOf: existingFragment.id,
                  },
                  version: 1,
                  versions: [],
                }
                await createFragment(dataDir, params.storyId, fragment)
                savedFragmentId = id
                requestLogger.info('Fragment variation created', { fragmentId: savedFragmentId, mode, originalId: existingFragment.id })

                // Add to prose chain as a variation
                const sectionIndex = await findSectionIndex(dataDir, params.storyId, existingFragment.id)
                if (sectionIndex !== -1) {
                  await addProseVariation(dataDir, params.storyId, sectionIndex, id)
                  requestLogger.info('Added as variation to prose chain', { sectionIndex })
                } else {
                  requestLogger.warn('Original fragment not found in prose chain, creating new section')
                  await addProseSection(dataDir, params.storyId, id)
                }

                // Run afterSave hooks
                await runAfterSave(enabledPlugins, fragment, params.storyId)
                requestLogger.info('AfterSave hooks completed')

                // Trigger librarian analysis (fire-and-forget)
                triggerLibrarian(dataDir, params.storyId, fragment).catch((err) => {
                  requestLogger.error('triggerLibrarian failed', { error: err instanceof Error ? err.message : String(err) })
                })
                requestLogger.info('Librarian analysis triggered')
              } else {
                // Create new fragment (default generate mode)
                const id = generateFragmentId('prose')
                const fragment: Fragment = {
                  id,
                  type: 'prose',
                  name: proseFragmentName,
                  description: body.input.slice(0, 250),
                  content: genResult.text,
                  tags: [],
                  refs: [],
                  sticky: false,
                  placement: 'user',
                  createdAt: now,
                  updatedAt: now,
                  order: 0,
                  meta: { generatedFrom: body.input },
                  version: 1,
                  versions: [],
                }
                await createFragment(dataDir, params.storyId, fragment)
                savedFragmentId = id
                requestLogger.info('New fragment created', { fragmentId: savedFragmentId })

                // Add to prose chain as a new section
                await addProseSection(dataDir, params.storyId, id)
                requestLogger.info('Added as new section to prose chain')

                // Run afterSave hooks
                await runAfterSave(enabledPlugins, fragment, params.storyId)
                requestLogger.info('AfterSave hooks completed')

                // Trigger librarian analysis (fire-and-forget)
                triggerLibrarian(dataDir, params.storyId, fragment).catch((err) => {
                  requestLogger.error('triggerLibrarian failed', { error: err instanceof Error ? err.message : String(err) })
                })
                requestLogger.info('Librarian analysis triggered')
              }

              // Capture finish reason, step count, and token usage
              const finishReason = lastFinishReason
              const stepsExceeded = stepCount >= 10 && finishReason !== 'stop'
              let totalUsage: { inputTokens: number; outputTokens: number } | undefined
              try {
                const rawUsage = await totalUsagePromise
                if (rawUsage && typeof rawUsage.inputTokens === 'number') {
                  totalUsage = { inputTokens: rawUsage.inputTokens, outputTokens: rawUsage.outputTokens ? rawUsage.outputTokens : 0 }
                  reportUsage(dataDir, params.storyId, 'generation.writer', totalUsage, resolvedModelId)
                }
              } catch {
                // Some providers may not report usage
              }

              // Persist generation log
              const logId = `gen-${Date.now().toString(36)}`
              const log: GenerationLog = {
                id: logId,
                createdAt: now,
                input: body.input,
                messages: logMessages.map((m) => ({
                  role: String(m.role),
                  content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                })),
                toolCalls,
                generatedText: genResult.text,
                fragmentId: savedFragmentId,
                model: resolvedModelId,
                durationMs,
                stepCount,
                finishReason: String(finishReason),
                stepsExceeded,
                ...(totalUsage ? { totalUsage } : {}),
                ...(fullReasoning ? { reasoning: fullReasoning } : {}),
                ...(prewriterBrief ? { prewriterBrief } : {}),
                ...(prewriterReasoning ? { prewriterReasoning } : {}),
                ...(prewriterLogMessages ? { prewriterMessages: prewriterLogMessages } : {}),
                ...(prewriterDurationMs ? { prewriterDurationMs } : {}),
                ...(prewriterModel ? { prewriterModel } : {}),
                ...(prewriterUsage ? { prewriterUsage } : {}),
                ...(prewriterDirections?.length ? { prewriterDirections } : {}),
              }
              await saveGenerationLog(dataDir, params.storyId, log)
              requestLogger.info('Generation log saved', { logId, stepCount, finishReason, stepsExceeded })
            } catch (err) {
              requestLogger.error('Error saving generation result', { error: err instanceof Error ? err.message : String(err) })
            }
            completionResolve?.()
          }
        },
        cancel() {
          abortController.abort()
        },
      })

      requestLogger.info('Streaming NDJSON response', { saveResult: body.saveResult ?? false })
      return new Response(eventStream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }, {
      body: t.Object({
        input: t.String(),
        saveResult: t.Optional(t.Boolean()),
        mode: t.Optional(t.Union([t.Literal('generate'), t.Literal('regenerate'), t.Literal('refine')])),
        fragmentId: t.Optional(t.String()),
      }),
    })
}
