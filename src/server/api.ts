import { Elysia, t } from 'elysia'
import { streamText, stepCountIs } from 'ai'
import {
  createStory,
  getStory,
  listStories,
  updateStory,
  deleteStory,
  createFragment,
  getFragment,
  listFragments,
  updateFragment,
  deleteFragment,
} from './fragments/storage'
import { createLogger } from './logging'
import {
  addTag,
  removeTag,
  getAssociations,
  addRef,
  removeRef,
  getRefs,
  getBackRefs,
} from './fragments/associations'
import {
  addProseSection,
  addProseVariation,
  findSectionIndex,
  getFullProseChain,
  switchActiveProse,
} from './fragments/prose-chain'
import { generateFragmentId } from '@/lib/fragment-ids'
import { registry } from './fragments/registry'
import { buildContextState, assembleMessages } from './llm/context-builder'
import { createFragmentTools } from './llm/tools'
import { defaultModel } from './llm/client'
import {
  saveGenerationLog,
  getGenerationLog,
  listGenerationLogs,
  type GenerationLog,
  type ToolCallLog,
} from './llm/generation-logs'
import { pluginRegistry } from './plugins/registry'
import {
  runBeforeContext,
  runBeforeGeneration,
  runAfterGeneration,
  runAfterSave,
} from './plugins/hooks'
import { collectPluginTools } from './plugins/tools'
import { triggerLibrarian } from './librarian/scheduler'
import {
  getState as getLibrarianState,
  listAnalyses as listLibrarianAnalyses,
  getAnalysis as getLibrarianAnalysis,
  saveAnalysis as saveLibrarianAnalysis,
} from './librarian/storage'
import type { StoryMeta, Fragment } from './fragments/schema'

const DATA_DIR = process.env.DATA_DIR ?? './data'

export function createApp(dataDir: string = DATA_DIR) {
  const logger = createLogger('api', { dataDir })
  const app = new Elysia({ prefix: '/api' })
    .get('/health', () => ({ status: 'ok' }))

    // --- Plugins ---
    .get('/plugins', () => {
      return pluginRegistry.listAll().map((p) => p.manifest)
    })

    // --- Story CRUD ---
    .post('/stories', async ({ body }) => {
      const now = new Date().toISOString()
      const id = `story-${Date.now().toString(36)}`
      const story: StoryMeta = {
        id,
        name: body.name,
        description: body.description,
        summary: '',
        createdAt: now,
        updatedAt: now,
        settings: { outputFormat: 'markdown', enabledPlugins: [] },
      }
      await createStory(dataDir, story)
      return story
    }, {
      body: t.Object({
        name: t.String(),
        description: t.String(),
      }),
    })

    .get('/stories', async () => {
      return listStories(dataDir)
    })

    .get('/stories/:storyId', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      return story
    })

    .put('/stories/:storyId', async ({ params, body, set }) => {
      const existing = await getStory(dataDir, params.storyId)
      if (!existing) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const updated: StoryMeta = {
        ...existing,
        name: body.name,
        description: body.description,
        updatedAt: new Date().toISOString(),
      }
      await updateStory(dataDir, updated)
      return updated
    }, {
      body: t.Object({
        name: t.String(),
        description: t.String(),
      }),
    })

    .delete('/stories/:storyId', async ({ params }) => {
      await deleteStory(dataDir, params.storyId)
      return { ok: true }
    })

    // --- Story Settings ---
    .patch('/stories/:storyId/settings', async ({ params, body, set }) => {
      const existing = await getStory(dataDir, params.storyId)
      if (!existing) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const updated: StoryMeta = {
        ...existing,
        settings: {
          ...existing.settings,
          ...(body.enabledPlugins !== undefined ? { enabledPlugins: body.enabledPlugins } : {}),
          ...(body.outputFormat !== undefined ? { outputFormat: body.outputFormat } : {}),
          ...(body.summarizationThreshold !== undefined ? { summarizationThreshold: body.summarizationThreshold } : {}),
        },
        updatedAt: new Date().toISOString(),
      }
      await updateStory(dataDir, updated)
      return updated
    }, {
      body: t.Object({
        enabledPlugins: t.Optional(t.Array(t.String())),
        outputFormat: t.Optional(t.Union([t.Literal('plaintext'), t.Literal('markdown')])),
        summarizationThreshold: t.Optional(t.Number()),
      }),
    })

    // --- Fragment CRUD ---
    .post('/stories/:storyId/fragments', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const now = new Date().toISOString()
      const id = generateFragmentId(body.type)
      const fragment: Fragment = {
        id,
        type: body.type as Fragment['type'],
        name: body.name,
        description: body.description,
        content: body.content,
        tags: [],
        refs: [],
        sticky: false,
        createdAt: now,
        updatedAt: now,
        order: 0,
        meta: {},
      }
      await createFragment(dataDir, params.storyId, fragment)
      return fragment
    }, {
      body: t.Object({
        type: t.String(),
        name: t.String(),
        description: t.String(),
        content: t.String(),
      }),
    })

    .get('/stories/:storyId/fragments', async ({ params, query }) => {
      const type = query.type as string | undefined
      return listFragments(dataDir, params.storyId, type)
    })

    .get('/stories/:storyId/fragments/:fragmentId', async ({ params, set }) => {
      const fragment = await getFragment(
        dataDir,
        params.storyId,
        params.fragmentId
      )
      if (!fragment) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      return fragment
    })

    .put('/stories/:storyId/fragments/:fragmentId', async ({ params, body, set }) => {
      const existing = await getFragment(
        dataDir,
        params.storyId,
        params.fragmentId
      )
      if (!existing) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      const updated: Fragment = {
        ...existing,
        name: body.name,
        description: body.description,
        content: body.content,
        updatedAt: new Date().toISOString(),
      }
      await updateFragment(dataDir, params.storyId, updated)
      return updated
    }, {
      body: t.Object({
        name: t.String(),
        description: t.String(),
        content: t.String(),
      }),
    })

    .patch('/stories/:storyId/fragments/:fragmentId', async ({ params, body, set }) => {
      const existing = await getFragment(
        dataDir,
        params.storyId,
        params.fragmentId
      )
      if (!existing) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      const newContent = existing.content.replace(body.oldText, body.newText)
      const updated: Fragment = {
        ...existing,
        content: newContent,
        updatedAt: new Date().toISOString(),
      }
      await updateFragment(dataDir, params.storyId, updated)
      return updated
    }, {
      body: t.Object({
        oldText: t.String(),
        newText: t.String(),
      }),
    })

    .delete('/stories/:storyId/fragments/:fragmentId', async ({ params }) => {
      await deleteFragment(dataDir, params.storyId, params.fragmentId)
      return { ok: true }
    })

    // --- Tags ---
    .get('/stories/:storyId/fragments/:fragmentId/tags', async ({ params }) => {
      const assoc = await getAssociations(dataDir, params.storyId)
      const tags: string[] = []
      for (const [tag, ids] of Object.entries(assoc.tagIndex)) {
        if (ids.includes(params.fragmentId)) {
          tags.push(tag)
        }
      }
      return { tags }
    })

    .post('/stories/:storyId/fragments/:fragmentId/tags', async ({ params, body }) => {
      await addTag(dataDir, params.storyId, params.fragmentId, body.tag)
      return { ok: true }
    }, {
      body: t.Object({ tag: t.String() }),
    })

    .delete('/stories/:storyId/fragments/:fragmentId/tags', async ({ params, body }) => {
      await removeTag(dataDir, params.storyId, params.fragmentId, body.tag)
      return { ok: true }
    }, {
      body: t.Object({ tag: t.String() }),
    })

    // --- Refs ---
    .get('/stories/:storyId/fragments/:fragmentId/refs', async ({ params }) => {
      const refs = await getRefs(dataDir, params.storyId, params.fragmentId)
      const backRefs = await getBackRefs(dataDir, params.storyId, params.fragmentId)
      return { refs, backRefs }
    })

    .post('/stories/:storyId/fragments/:fragmentId/refs', async ({ params, body }) => {
      await addRef(dataDir, params.storyId, params.fragmentId, body.targetId)
      return { ok: true }
    }, {
      body: t.Object({ targetId: t.String() }),
    })

    .delete('/stories/:storyId/fragments/:fragmentId/refs', async ({ params, body }) => {
      await removeRef(dataDir, params.storyId, params.fragmentId, body.targetId)
      return { ok: true }
    }, {
      body: t.Object({ targetId: t.String() }),
    })

    // --- Sticky toggle ---
    .patch('/stories/:storyId/fragments/:fragmentId/sticky', async ({ params, body, set }) => {
      const existing = await getFragment(dataDir, params.storyId, params.fragmentId)
      if (!existing) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      const updated: Fragment = {
        ...existing,
        sticky: body.sticky,
        updatedAt: new Date().toISOString(),
      }
      await updateFragment(dataDir, params.storyId, updated)
      return { ok: true, sticky: body.sticky }
    }, {
      body: t.Object({ sticky: t.Boolean() }),
    })

    // --- Fragment types ---
    .get('/stories/:storyId/fragment-types', () => {
      return registry.listTypes().map((t) => ({
        type: t.type,
        prefix: t.prefix,
        stickyByDefault: t.stickyByDefault,
      }))
    })

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
      return getLibrarianState(dataDir, params.storyId)
    })

    .get('/stories/:storyId/librarian/analyses', async ({ params }) => {
      return listLibrarianAnalyses(dataDir, params.storyId)
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
      analysis.knowledgeSuggestions[index].accepted = true
      await saveLibrarianAnalysis(dataDir, params.storyId, analysis)
      return analysis
    })

    // --- Fragment Revert ---
    .post('/stories/:storyId/fragments/:fragmentId/revert', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const fragment = await getFragment(dataDir, params.storyId, params.fragmentId)
      if (!fragment) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      const previousContent = fragment.meta?.previousContent
      if (typeof previousContent !== 'string') {
        set.status = 422
        return { error: 'No previous content to revert to' }
      }
      const updated: Fragment = {
        ...fragment,
        content: previousContent,
        meta: { ...fragment.meta, previousContent: undefined },
        updatedAt: new Date().toISOString(),
      }
      await updateFragment(dataDir, params.storyId, updated)
      return updated
    })

    // --- Generation ---
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
      requestLogger.info('Building context...')
      let ctxState = await buildContextState(dataDir, params.storyId, effectiveInput)
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

      // Merge fragment tools + plugin tools
      const fragmentTools = createFragmentTools(dataDir, params.storyId, { readOnly: true })
      const pluginTools = collectPluginTools(enabledPlugins, dataDir, params.storyId)
      const tools = { ...fragmentTools, ...pluginTools }
      requestLogger.info('Tools prepared', { toolCount: Object.keys(tools).length })

      // Extract plugin tool descriptions for context (fragment tools are listed from registry)
      const extraTools = Object.entries(pluginTools).map(([name, t]) => ({
        name,
        description: (t as { description?: string }).description ?? '',
      }))

      let messages = assembleMessages(ctxState, extraTools.length > 0 ? { extraTools } : undefined)
      messages = await runBeforeGeneration(enabledPlugins, messages)
      requestLogger.info('BeforeGeneration hooks completed', { messageCount: messages.length })

      requestLogger.info('Starting LLM stream...')
      const result = streamText({
        model: defaultModel,
        messages,
        tools,
        toolChoice: 'auto',
        stopWhen: stepCountIs(10),
      })

      // If saveResult is true, we need to stream AND save
      if (body.saveResult) {
        requestLogger.info('Streaming with save enabled')
        
        // Get the text stream
        const textStream = result.textStream
        
        // Tee the stream so we can both stream to client and collect for saving
        const [clientStream, saveStream] = textStream.tee()
        
        // Start the async save operation
        const saveOperation = async () => {
          try {
            // Collect text from the save stream
            let fullText = ''
            const reader = saveStream.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              fullText += value
            }
            
            const durationMs = Date.now() - startTime
            requestLogger.info('LLM generation completed', { durationMs, textLength: fullText.length })

            // Extract tool calls from steps
            const steps = await result.steps
            const toolCalls: ToolCallLog[] = []
            if (Array.isArray(steps)) {
              for (const step of steps) {
                const stepObj = step as { toolResults?: Array<{ toolName: string; input: unknown; output: unknown }> }
                if (Array.isArray(stepObj.toolResults)) {
                  for (const tr of stepObj.toolResults) {
                    toolCalls.push({
                      toolName: tr.toolName,
                      args: (tr.input as Record<string, unknown>) ?? {},
                      result: tr.output,
                    })
                  }
                }
              }
            }
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
                name: existingFragment.name,
                description: body.input.slice(0, 50),
                content: genResult.text,
                tags: [...existingFragment.tags],
                refs: [...existingFragment.refs],
                sticky: existingFragment.sticky,
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
              triggerLibrarian(dataDir, params.storyId, fragment)
              requestLogger.info('Librarian analysis triggered')
            } else {
              // Create new fragment (default generate mode)
              const id = generateFragmentId('prose')
              const fragment: Fragment = {
                id,
                type: 'prose',
                name: `Generated ${new Date().toLocaleDateString()}`,
                description: body.input.slice(0, 50),
                content: genResult.text,
                tags: [],
                refs: [],
                sticky: false,
                createdAt: now,
                updatedAt: now,
                order: 0,
                meta: { generatedFrom: body.input },
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
              triggerLibrarian(dataDir, params.storyId, fragment)
              requestLogger.info('Librarian analysis triggered')
            }

            // Capture finish reason and step count
            const finishReason = await result.finishReason ?? 'unknown'
            const stepCount = Array.isArray(steps) ? steps.length : 1
            const stepsExceeded = stepCount >= 10 && finishReason !== 'stop'

            // Persist generation log
            const logId = `gen-${Date.now().toString(36)}`
            const log: GenerationLog = {
              id: logId,
              createdAt: now,
              input: body.input,
              messages: messages.map((m) => ({
                role: String(m.role),
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              })),
              toolCalls,
              generatedText: genResult.text,
              fragmentId: savedFragmentId,
              model: 'deepseek-chat',
              durationMs,
              stepCount,
              finishReason: String(finishReason),
              stepsExceeded,
            }
            await saveGenerationLog(dataDir, params.storyId, log)
            requestLogger.info('Generation log saved', { logId, stepCount, finishReason, stepsExceeded })
          } catch (err) {
            requestLogger.error('Error saving generation result', { error: err instanceof Error ? err.message : String(err) })
          }
        }

        // Start save operation in background (fire-and-forget)
        saveOperation()

        // Encode the string stream to bytes for the response
        const encoder = new TextEncoder()
        const encodedStream = clientStream.pipeThrough(new TransformStream<string, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk))
          }
        }))

        // Return the encoded stream immediately
        return new Response(encodedStream, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }

      // Stream the response (no log for streaming-only requests)
      requestLogger.info('Streaming response (no persistence)')
      return result.toTextStreamResponse()
    }, {
      body: t.Object({
        input: t.String(),
        saveResult: t.Optional(t.Boolean()),
        mode: t.Optional(t.Union([t.Literal('generate'), t.Literal('regenerate'), t.Literal('refine')])),
        fragmentId: t.Optional(t.String()),
      }),
    })

    // --- Prose Chain API ---
    .get('/stories/:storyId/prose-chain', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const chain = await getFullProseChain(dataDir, params.storyId)
      if (!chain) {
        return { entries: [] }
      }

      // Load the actual fragments for each variation
      const entriesWithFragments = await Promise.all(
        chain.entries.map(async (entry) => {
          const fragments = await Promise.all(
            entry.proseFragments.map(async (id) => {
              const fragment = await getFragment(dataDir, params.storyId, id)
              return fragment ? {
                id: fragment.id,
                name: fragment.name,
                description: fragment.description,
                createdAt: fragment.createdAt,
                generationMode: fragment.meta?.generationMode,
              } : null
            })
          )
          return {
            proseFragments: fragments.filter(Boolean),
            active: entry.active,
          }
        })
      )

      return { entries: entriesWithFragments }
    })

    .post('/stories/:storyId/prose-chain/:sectionIndex/switch', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const sectionIndex = parseInt(params.sectionIndex, 10)
      if (isNaN(sectionIndex) || sectionIndex < 0) {
        set.status = 400
        return { error: 'Invalid section index' }
      }

      try {
        await switchActiveProse(dataDir, params.storyId, sectionIndex, body.fragmentId)
        return { ok: true }
      } catch (err) {
        set.status = 400
        return { error: err instanceof Error ? err.message : 'Failed to switch active prose' }
      }
    }, {
      body: t.Object({
        fragmentId: t.String(),
      }),
    })

  // Mount plugin routes
  for (const plugin of pluginRegistry.listAll()) {
    if (plugin.routes) {
      const pluginApp = new Elysia({ prefix: `/plugins/${plugin.manifest.name}` })
      plugin.routes(pluginApp)
      app.use(pluginApp)
    }
  }

  return app
}

export const app = createApp()

export type App = typeof app
