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
import {
  addTag,
  removeTag,
  getAssociations,
  addRef,
  removeRef,
  getRefs,
  getBackRefs,
} from './fragments/associations'
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
} from './librarian/storage'
import type { StoryMeta, Fragment } from './fragments/schema'

const DATA_DIR = process.env.DATA_DIR ?? './data'

export function createApp(dataDir: string = DATA_DIR) {
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
        },
        updatedAt: new Date().toISOString(),
      }
      await updateStory(dataDir, updated)
      return updated
    }, {
      body: t.Object({
        enabledPlugins: t.Optional(t.Array(t.String())),
        outputFormat: t.Optional(t.Union([t.Literal('plaintext'), t.Literal('markdown')])),
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

    // --- Generation ---
    .post('/stories/:storyId/generate', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      if (!body.input || body.input.trim() === '') {
        set.status = 422
        return { error: 'Input is required' }
      }

      const startTime = Date.now()

      // Get enabled plugins
      const enabledPlugins = pluginRegistry.getEnabled(
        story.settings.enabledPlugins,
      )

      // Build context with plugin hooks
      let ctxState = await buildContextState(dataDir, params.storyId, body.input)
      ctxState = await runBeforeContext(enabledPlugins, ctxState)

      // Merge fragment tools + plugin tools
      const fragmentTools = createFragmentTools(dataDir, params.storyId, { readOnly: true })
      const pluginTools = collectPluginTools(enabledPlugins, dataDir, params.storyId)
      const tools = { ...fragmentTools, ...pluginTools }

      // Extract plugin tool descriptions for context (fragment tools are listed from registry)
      const extraTools = Object.entries(pluginTools).map(([name, t]) => ({
        name,
        description: (t as { description?: string }).description ?? '',
      }))

      let messages = assembleMessages(ctxState, extraTools.length > 0 ? { extraTools } : undefined)
      messages = await runBeforeGeneration(enabledPlugins, messages)

      const result = streamText({
        model: defaultModel,
        messages,
        tools,
        toolChoice: 'auto',
        stopWhen: stepCountIs(10),
      })

      // If saveResult is true, consume the text and save as a new prose fragment
      if (body.saveResult) {
        const text = await result.text
        const durationMs = Date.now() - startTime

        // Extract tool calls from steps
        const steps = await result.steps
        const toolCalls: ToolCallLog[] = []
        if (Array.isArray(steps)) {
          for (const step of steps) {
            const stepObj = step as { toolResults?: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }> }
            if (Array.isArray(stepObj.toolResults)) {
              for (const tr of stepObj.toolResults) {
                toolCalls.push({
                  toolName: tr.toolName,
                  args: tr.args ?? {},
                  result: tr.result,
                })
              }
            }
          }
        }

        // Run afterGeneration hooks
        let genResult = await runAfterGeneration(enabledPlugins, {
          text,
          fragmentId: null,
          toolCalls,
        })

        const now = new Date().toISOString()
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

        // Run afterSave hooks
        await runAfterSave(enabledPlugins, fragment, params.storyId)

        // Trigger librarian analysis (fire-and-forget)
        triggerLibrarian(dataDir, params.storyId, fragment)

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
          fragmentId: id,
          model: 'deepseek-chat',
          durationMs,
          stepCount,
          finishReason: String(finishReason),
          stepsExceeded,
        }
        await saveGenerationLog(dataDir, params.storyId, log)

        return new Response(genResult.text, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }

      // Stream the response (no log for streaming-only requests)
      return result.toTextStreamResponse()
    }, {
      body: t.Object({
        input: t.String(),
        saveResult: t.Optional(t.Boolean()),
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
