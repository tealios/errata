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
  archiveFragment,
  restoreFragment,
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
  removeProseSection,
} from './fragments/prose-chain'
import { generateFragmentId } from '@/lib/fragment-ids'
import { registry } from './fragments/registry'
import { buildContextState, assembleMessages } from './llm/context-builder'
import { createFragmentTools } from './llm/tools'
import { getModel } from './llm/client'
import {
  getGlobalConfigSafe,
  addProvider,
  updateProvider as updateProviderConfig,
  deleteProvider as deleteProviderConfig,
  getGlobalConfig,
  saveGlobalConfig,
  getProvider,
} from './config/storage'
import { ProviderConfigSchema } from './config/schema'
import {
  saveGenerationLog,
  getGenerationLog,
  listGenerationLogs,
  type GenerationLog,
  type ToolCallLog,
} from './llm/generation-logs'
import { pluginRegistry } from './plugins/registry'
import { getRuntimePluginUi } from './plugins/runtime-ui'
import {
  runBeforeContext,
  runBeforeGeneration,
  runAfterGeneration,
  runAfterSave,
} from './plugins/hooks'
import { collectPluginTools } from './plugins/tools'
import { triggerLibrarian } from './librarian/scheduler'
import { refineFragment } from './librarian/refine'
import { librarianChat } from './librarian/chat'
import { exportStoryAsZip, importStoryFromZip } from './story-archive'
import {
  getState as getLibrarianState,
  listAnalyses as listLibrarianAnalyses,
  getAnalysis as getLibrarianAnalysis,
  saveAnalysis as saveLibrarianAnalysis,
  getChatHistory as getLibrarianChatHistory,
  saveChatHistory as saveLibrarianChatHistory,
  clearChatHistory as clearLibrarianChatHistory,
} from './librarian/storage'
import type { StoryMeta, Fragment } from './fragments/schema'
import { dirname, extname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const DATA_DIR = process.env.DATA_DIR ?? './data'

function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase()
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.js': return 'application/javascript; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.ico': return 'image/x-icon'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

export function createApp(dataDir: string = DATA_DIR) {
  const logger = createLogger('api', { dataDir })
  const app = new Elysia({ prefix: '/api' })
    .get('/health', () => ({ status: 'ok' }))

    // --- Plugins ---
    .get('/plugins', () => {
      return pluginRegistry.listAll().map((p) => {
        const runtimeUi = getRuntimePluginUi(p.manifest.name)
        if (!runtimeUi) return p.manifest

        return {
          ...p.manifest,
          panel: p.manifest.panel
            ? {
              ...p.manifest.panel,
              mode: 'iframe',
              url: `/api/plugins/${p.manifest.name}/ui/`,
            }
            : undefined,
        }
      })
    })
    .get('/plugins/:pluginName/ui/*', ({ params, set }) => {
      const runtimeUi = getRuntimePluginUi(params.pluginName)
      if (!runtimeUi) {
        set.status = 404
        return { error: 'Plugin UI not found' }
      }

      const requestedAsset = (params as Record<string, string>)['*'] ?? ''
      const entryPath = resolve(runtimeUi.pluginRoot, runtimeUi.entryFile)
      const baseDir = dirname(entryPath)
      const targetPath = requestedAsset ? resolve(baseDir, requestedAsset) : entryPath

      const normalizedRoot = runtimeUi.pluginRoot.replace(/\\/g, '/').toLowerCase()
      const normalizedTarget = targetPath.replace(/\\/g, '/').toLowerCase()
      if (!normalizedTarget.startsWith(`${normalizedRoot}/`) && normalizedTarget !== normalizedRoot) {
        set.status = 403
        return { error: 'Access denied' }
      }

      if (!existsSync(targetPath)) {
        set.status = 404
        return { error: 'Plugin asset not found' }
      }

      return new Response(Bun.file(targetPath), {
        headers: {
          'content-type': contentTypeForPath(targetPath),
          'cache-control': 'no-cache',
        },
      })
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
        settings: { outputFormat: 'markdown', enabledPlugins: [], summarizationThreshold: 4, maxSteps: 10, providerId: null, modelId: null, contextOrderMode: 'simple' as const, fragmentOrder: [] },
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
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        updatedAt: new Date().toISOString(),
      }
      await updateStory(dataDir, updated)
      return updated
    }, {
      body: t.Object({
        name: t.String(),
        description: t.String(),
        summary: t.Optional(t.String()),
      }),
    })

    .delete('/stories/:storyId', async ({ params }) => {
      await deleteStory(dataDir, params.storyId)
      return { ok: true }
    })

    // --- Story Export/Import ---
    .get('/stories/:storyId/export', async ({ params, query, set }) => {
      try {
        const includeLogs = (query as Record<string, string>).includeLogs === 'true'
        const includeLibrarian = (query as Record<string, string>).includeLibrarian === 'true'
        const { buffer, filename } = await exportStoryAsZip(dataDir, params.storyId, {
          includeLogs,
          includeLibrarian,
        })
        return new Response(buffer.buffer as ArrayBuffer, {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        })
      } catch (err) {
        set.status = 404
        return { error: err instanceof Error ? err.message : 'Export failed' }
      }
    })

    .post('/stories/import', async ({ request, set }) => {
      try {
        const formData = await request.formData()
        const file = formData.get('file')
        if (!file || !(file instanceof File)) {
          set.status = 400
          return { error: 'No file provided' }
        }
        const arrayBuffer = await file.arrayBuffer()
        const zipBuffer = new Uint8Array(arrayBuffer)
        const newStory = await importStoryFromZip(dataDir, zipBuffer)
        return newStory
      } catch (err) {
        set.status = 422
        return { error: err instanceof Error ? err.message : 'Import failed' }
      }
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
          ...(body.maxSteps !== undefined ? { maxSteps: body.maxSteps } : {}),
          ...(body.providerId !== undefined ? { providerId: body.providerId } : {}),
          ...(body.modelId !== undefined ? { modelId: body.modelId } : {}),
          ...(body.contextOrderMode !== undefined ? { contextOrderMode: body.contextOrderMode } : {}),
          ...(body.fragmentOrder !== undefined ? { fragmentOrder: body.fragmentOrder } : {}),
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
        maxSteps: t.Optional(t.Number()),
        providerId: t.Optional(t.Union([t.String(), t.Null()])),
        modelId: t.Optional(t.Union([t.String(), t.Null()])),
        contextOrderMode: t.Optional(t.Union([t.Literal('simple'), t.Literal('advanced')])),
        fragmentOrder: t.Optional(t.Array(t.String())),
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
        sticky: registry.getType(body.type)?.stickyByDefault ?? false,
        placement: 'user',
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
      const includeArchived = (query as Record<string, string>).includeArchived === 'true'
      return listFragments(dataDir, params.storyId, type, { includeArchived })
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
        ...(body.sticky !== undefined ? { sticky: body.sticky } : {}),
        ...(body.order !== undefined ? { order: body.order } : {}),
        ...(body.placement !== undefined ? { placement: body.placement } : {}),
        ...(body.meta !== undefined ? { meta: body.meta } : {}),
        updatedAt: new Date().toISOString(),
      }
      await updateFragment(dataDir, params.storyId, updated)
      return updated
    }, {
      body: t.Object({
        name: t.String(),
        description: t.String(),
        content: t.String(),
        sticky: t.Optional(t.Boolean()),
        order: t.Optional(t.Number()),
        placement: t.Optional(t.Union([t.Literal('system'), t.Literal('user')])),
        meta: t.Optional(t.Record(t.String(), t.Any())),
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

    .delete('/stories/:storyId/fragments/:fragmentId', async ({ params, set }) => {
      const fragment = await getFragment(dataDir, params.storyId, params.fragmentId)
      if (!fragment) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      const isArchived = Boolean((fragment as Fragment & { archived?: boolean }).archived)
      if (!isArchived) {
        set.status = 422
        return { error: 'Fragment must be archived before deletion' }
      }
      await deleteFragment(dataDir, params.storyId, params.fragmentId)
      return { ok: true }
    })

    // --- Archive / Restore ---
    .post('/stories/:storyId/fragments/:fragmentId/archive', async ({ params, set }) => {
      const result = await archiveFragment(dataDir, params.storyId, params.fragmentId)
      if (!result) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      return result
    })

    .post('/stories/:storyId/fragments/:fragmentId/restore', async ({ params, set }) => {
      const result = await restoreFragment(dataDir, params.storyId, params.fragmentId)
      if (!result) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      return result
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

    // --- Fragment reorder (bulk) ---
    .patch('/stories/:storyId/fragments/reorder', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      for (const item of body.items) {
        const fragment = await getFragment(dataDir, params.storyId, item.id)
        if (fragment) {
          const updated: Fragment = {
            ...fragment,
            order: item.order,
            updatedAt: new Date().toISOString(),
          }
          await updateFragment(dataDir, params.storyId, updated)
        }
      }
      return { ok: true }
    }, {
      body: t.Object({
        items: t.Array(t.Object({
          id: t.String(),
          order: t.Number(),
        })),
      }),
    })

    // --- Fragment placement ---
    .patch('/stories/:storyId/fragments/:fragmentId/placement', async ({ params, body, set }) => {
      const existing = await getFragment(dataDir, params.storyId, params.fragmentId)
      if (!existing) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      const updated: Fragment = {
        ...existing,
        placement: body.placement,
        updatedAt: new Date().toISOString(),
      }
      await updateFragment(dataDir, params.storyId, updated)
      return { ok: true, placement: body.placement }
    }, {
      body: t.Object({
        placement: t.Union([t.Literal('system'), t.Literal('user')]),
      }),
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

      const suggestion = analysis.knowledgeSuggestions[index]
      let createdFragmentId: string | null = suggestion.createdFragmentId ?? null

      if (!suggestion.accepted || !createdFragmentId) {
        createdFragmentId = generateFragmentId(suggestion.type)
        const now = new Date().toISOString()
        const fragment: Fragment = {
          id: createdFragmentId,
          type: suggestion.type,
          name: suggestion.name,
          description: suggestion.description.slice(0, 50),
          content: suggestion.content,
          tags: [],
          refs: [],
          sticky: registry.getType(suggestion.type)?.stickyByDefault ?? false,
          placement: 'user',
          createdAt: now,
          updatedAt: now,
          order: 0,
          meta: {
            source: 'librarian-suggestion',
            analysisId: analysis.id,
            suggestionIndex: index,
          },
        }
        await createFragment(dataDir, params.storyId, fragment)
      }

      analysis.knowledgeSuggestions[index].accepted = true
      analysis.knowledgeSuggestions[index].createdFragmentId = createdFragmentId
      await saveLibrarianAnalysis(dataDir, params.storyId, analysis)
      return {
        analysis,
        createdFragmentId,
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
        const { textStream, completion } = await refineFragment(dataDir, params.storyId, {
          fragmentId: body.fragmentId,
          instructions: body.instructions,
          maxSteps: story.settings.maxSteps ?? 5,
        })

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

        // Encode text stream to bytes
        const encoder = new TextEncoder()
        const encodedStream = textStream.pipeThrough(new TransformStream<string, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk))
          }
        }))

        return new Response(encodedStream, {
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
        const { eventStream, completion } = await librarianChat(dataDir, params.storyId, {
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

        // Encode NDJSON event stream to bytes
        const encoder = new TextEncoder()
        const encodedStream = eventStream.pipeThrough(new TransformStream<string, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk))
          }
        }))

        return new Response(encodedStream, {
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
      // When regenerating/refining, exclude the fragment being replaced from context
      requestLogger.info('Building context...')
      const buildContextOpts = (mode === 'regenerate' || mode === 'refine') && existingFragment
        ? { excludeFragmentId: existingFragment.id }
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
      const { model, modelId: resolvedModelId } = await getModel(dataDir, params.storyId)
      requestLogger.info('Resolved model', { resolvedModelId })
      const result = streamText({
        model,
        messages,
        tools,
        toolChoice: 'auto',
        stopWhen: stepCountIs(story.settings.maxSteps ?? 10),
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
                placement: 'user',
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
              model: resolvedModelId,
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

    .post('/stories/:storyId/prose-chain', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      try {
        await addProseSection(dataDir, params.storyId, body.fragmentId)
        return { ok: true }
      } catch (err) {
        set.status = 400
        return { error: err instanceof Error ? err.message : 'Failed to add prose section' }
      }
    }, {
      body: t.Object({
        fragmentId: t.String(),
      }),
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

    .delete('/stories/:storyId/prose-chain/:sectionIndex', async ({ params, set }) => {
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
        const fragmentIds = await removeProseSection(dataDir, params.storyId, sectionIndex)
        // Archive all fragments that were in the section
        const archivedFragmentIds: string[] = []
        for (const fid of fragmentIds) {
          try {
            await archiveFragment(dataDir, params.storyId, fid)
            archivedFragmentIds.push(fid)
          } catch {
            // Fragment may already be archived or deleted
          }
        }
        return { ok: true, archivedFragmentIds }
      } catch (err) {
        set.status = 400
        return { error: err instanceof Error ? err.message : 'Failed to remove prose section' }
      }
    })

    // --- Config / Providers ---
    .get('/config/providers', async () => {
      return getGlobalConfigSafe(dataDir)
    })

    .post('/config/providers', async ({ body }) => {
      const id = `prov-${Date.now().toString(36)}`
      const provider = ProviderConfigSchema.parse({
        id,
        name: body.name,
        preset: body.preset ?? 'custom',
        baseURL: body.baseURL,
        apiKey: body.apiKey,
        defaultModel: body.defaultModel,
        enabled: true,
        customHeaders: body.customHeaders ?? {},
        createdAt: new Date().toISOString(),
      })
      const config = await addProvider(dataDir, provider)
      return {
        ...config,
        providers: config.providers.map((p) => ({
          ...p,
          apiKey: '••••' + p.apiKey.slice(-4),
        })),
      }
    }, {
      body: t.Object({
        name: t.String(),
        preset: t.Optional(t.String()),
        baseURL: t.String(),
        apiKey: t.String(),
        defaultModel: t.String(),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
      }),
    })

    .put('/config/providers/:providerId', async ({ params, body }) => {
      const updates: Record<string, unknown> = {}
      if (body.name !== undefined) updates.name = body.name
      if (body.baseURL !== undefined) updates.baseURL = body.baseURL
      if (body.apiKey !== undefined) updates.apiKey = body.apiKey
      if (body.defaultModel !== undefined) updates.defaultModel = body.defaultModel
      if (body.enabled !== undefined) updates.enabled = body.enabled
      if (body.customHeaders !== undefined) updates.customHeaders = body.customHeaders
      const config = await updateProviderConfig(dataDir, params.providerId, updates)
      return {
        ...config,
        providers: config.providers.map((p) => ({
          ...p,
          apiKey: '••••' + p.apiKey.slice(-4),
        })),
      }
    }, {
      body: t.Object({
        name: t.Optional(t.String()),
        baseURL: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        defaultModel: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
      }),
    })

    .delete('/config/providers/:providerId', async ({ params }) => {
      const config = await deleteProviderConfig(dataDir, params.providerId)
      return {
        ...config,
        providers: config.providers.map((p) => ({
          ...p,
          apiKey: '••••' + p.apiKey.slice(-4),
        })),
      }
    })

    .patch('/config/default-provider', async ({ body }) => {
      const config = await getGlobalConfig(dataDir)
      config.defaultProviderId = body.providerId
      await saveGlobalConfig(dataDir, config)
      return { ok: true, defaultProviderId: body.providerId }
    }, {
      body: t.Object({
        providerId: t.Union([t.String(), t.Null()]),
      }),
    })

    .get('/config/providers/:providerId/models', async ({ params, set }) => {
      const provider = await getProvider(dataDir, params.providerId)
      if (!provider) {
        set.status = 404
        return { models: [], error: 'Provider not found' }
      }
      try {
        const base = provider.baseURL.replace(/\/+$/, '')
        const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            ...(provider.customHeaders ?? {}),
          },
        })
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          return { models: [], error: `Failed to fetch models: ${res.status} ${text}` }
        }
        const json = await res.json() as { data?: Array<{ id: string; owned_by?: string }> }
        const models = (json.data ?? []).map((m) => ({
          id: m.id,
          owned_by: m.owned_by,
        }))
        models.sort((a, b) => a.id.localeCompare(b.id))
        return { models }
      } catch (err) {
        return { models: [], error: err instanceof Error ? err.message : 'Unknown error fetching models' }
      }
    })

    // Fetch models with arbitrary credentials (for unsaved providers, avoids CORS)
    .post('/config/test-models', async ({ body }) => {
      try {
        const base = body.baseURL.replace(/\/+$/, '')
        const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${body.apiKey}`,
            ...(body.customHeaders ?? {}),
          },
        })
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          return { models: [], error: `Failed to fetch models: ${res.status} ${text}` }
        }
        const json = await res.json() as { data?: Array<{ id: string; owned_by?: string }> }
        const models = (json.data ?? []).map((m) => ({
          id: m.id,
          owned_by: m.owned_by,
        }))
        models.sort((a, b) => a.id.localeCompare(b.id))
        return { models }
      } catch (err) {
        return { models: [], error: err instanceof Error ? err.message : 'Unknown error fetching models' }
      }
    }, {
      body: t.Object({
        baseURL: t.String(),
        apiKey: t.String(),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
      }),
    })

    // Test a provider by sending a short chat completion
    // Can use either providerId (reads stored credentials) or inline baseURL+apiKey
    .post('/config/test-connection', async ({ body }) => {
      let baseURL = body.baseURL
      let apiKey = body.apiKey
      let customHeaders = body.customHeaders ?? {}

      // If providerId is given, use stored credentials as fallback
      if (body.providerId) {
        const stored = await getProvider(dataDir, body.providerId)
        if (stored) {
          if (!baseURL) baseURL = stored.baseURL
          if (!apiKey) apiKey = stored.apiKey
          if (Object.keys(customHeaders).length === 0) customHeaders = stored.customHeaders ?? {}
        }
      }

      if (!baseURL || !apiKey || !body.model) {
        return { ok: false, error: 'Base URL, API key, and model are required' }
      }

      try {
        const base = baseURL.replace(/\/+$/, '')
        const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...customHeaders,
          },
          body: JSON.stringify({
            model: body.model,
            messages: [{ role: 'user', content: 'Hello! (keep your response short)' }],
            max_tokens: 64,
          }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          return { ok: false, error: `${res.status} ${text}` }
        }
        const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
        const reply = json.choices?.[0]?.message?.content ?? ''
        return { ok: true, reply }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
      }
    }, {
      body: t.Object({
        providerId: t.Optional(t.String()),
        baseURL: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        model: t.String(),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
      }),
    })

  // Mount plugin routes
  for (const plugin of pluginRegistry.listAll()) {
    if (plugin.routes) {
      const pluginApp = new Elysia({ prefix: `/plugins/${plugin.manifest.name}` })
      plugin.routes(pluginApp as unknown as Elysia)
      app.use(pluginApp)
    }
  }

  return app
}

export const app = createApp()

export type App = typeof app
