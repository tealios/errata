import { Elysia, t } from 'elysia'
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
  updateFragmentVersioned,
  deleteFragment,
  archiveFragment,
  restoreFragment,
  listFragmentVersions,
  revertFragmentToVersion,
} from './fragments/storage'
import { createLogger } from './logging'
import {
  addTag,
  removeTag,
  addRef,
  removeRef,
  getRefs,
  getBackRefs,
} from './fragments/associations'
import {
  addProseSection,
  addProseVariation,
  insertProseSection,
  findSectionIndex,
  getFullProseChain,
  switchActiveProse,
  removeProseSection,
} from './fragments/prose-chain'
import { generateFragmentId } from '@/lib/fragment-ids'
import { registry } from './fragments/registry'
import { buildContextState, createDefaultBlocks, compileBlocks } from './llm/context-builder'
import { getBlockConfig, addCustomBlock, updateCustomBlock, deleteCustomBlock, updateBlockOverrides } from './blocks/storage'
import { applyBlockConfig } from './blocks/apply'
import { CustomBlockDefinitionSchema } from './blocks/schema'
import { createFragmentTools } from './llm/tools'
import { getModel } from './llm/client'
import { createWriterAgent } from './llm/writer-agent'
import {
  getGlobalConfigSafe,
  addProvider,
  updateProvider as updateProviderConfig,
  deleteProvider as deleteProviderConfig,
  duplicateProvider as duplicateProviderConfig,
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
  runBeforeBlocks,
  runBeforeGeneration,
  runAfterGeneration,
  runAfterSave,
} from './plugins/hooks'
import { collectPluginToolsWithOrigin } from './plugins/tools'
import { triggerLibrarian, getLibrarianRuntimeStatus } from './librarian/scheduler'
import { createSSEStream } from './librarian/analysis-stream'
import { invokeAgent, listAgentRuns } from './agents'
import { exportStoryAsZip, importStoryFromZip } from './story-archive'
import type { RefineResult } from './librarian/refine'
import type { ChatResult } from './librarian/chat'
import type { ChatResult as CharacterChatResult } from './character-chat/chat'
import {
  saveConversation as saveCharacterConversation,
  getConversation as getCharacterConversation,
  listConversations as listCharacterConversations,
  deleteConversation as deleteCharacterConversation,
  generateConversationId,
  type CharacterChatConversation,
} from './character-chat/storage'
import type { ProseTransformResult } from './librarian/prose-transform'
import {
  getState as getLibrarianState,
  listAnalyses as listLibrarianAnalyses,
  getAnalysis as getLibrarianAnalysis,
  saveAnalysis as saveLibrarianAnalysis,
  getChatHistory as getLibrarianChatHistory,
  saveChatHistory as saveLibrarianChatHistory,
  clearChatHistory as clearLibrarianChatHistory,
} from './librarian/storage'
import { applyKnowledgeSuggestion } from './librarian/suggestions'
import type { StoryMeta, Fragment } from './fragments/schema'
import {
  getBranchesIndex,
  switchActiveBranch,
  createBranch,
  deleteBranch,
  renameBranch,
} from './fragments/branches'
import { dirname, extname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const DATA_DIR = process.env.DATA_DIR ?? './data'

function hasMaterialProseChange(before: Fragment, after: Fragment): boolean {
  return before.name !== after.name
    || before.description !== after.description
    || before.content !== after.content
}

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
      const slug = body.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)
        .replace(/-$/, '')
      const id = `${slug || 'story'}-${Date.now().toString(36)}`
      const story: StoryMeta = {
        id,
        name: body.name,
        description: body.description,
        summary: '',
        createdAt: now,
        updatedAt: now,
        settings: {
          outputFormat: 'markdown',
          enabledPlugins: [],
          summarizationThreshold: 4,
          maxSteps: 10,
          providerId: null,
          modelId: null,
          librarianProviderId: null,
          librarianModelId: null,
          autoApplyLibrarianSuggestions: false,
          contextOrderMode: 'simple' as const,
          fragmentOrder: [],
          enabledBuiltinTools: [],
          contextCompact: { type: 'proseLimit' as const, value: 10 },
          summaryCompact: { maxCharacters: 12000, targetCharacters: 9000 },
          enableHierarchicalSummary: false,
          characterChatProviderId: null,
          characterChatModelId: null,
          proseTransformProviderId: null,
          proseTransformModelId: null,
          librarianChatProviderId: null,
          librarianChatModelId: null,
          librarianRefineProviderId: null,
          librarianRefineModelId: null,
        },
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
          ...(body.librarianProviderId !== undefined ? { librarianProviderId: body.librarianProviderId } : {}),
          ...(body.librarianModelId !== undefined ? { librarianModelId: body.librarianModelId } : {}),
          ...(body.characterChatProviderId !== undefined ? { characterChatProviderId: body.characterChatProviderId } : {}),
          ...(body.characterChatModelId !== undefined ? { characterChatModelId: body.characterChatModelId } : {}),
          ...(body.proseTransformProviderId !== undefined ? { proseTransformProviderId: body.proseTransformProviderId } : {}),
          ...(body.proseTransformModelId !== undefined ? { proseTransformModelId: body.proseTransformModelId } : {}),
          ...(body.librarianChatProviderId !== undefined ? { librarianChatProviderId: body.librarianChatProviderId } : {}),
          ...(body.librarianChatModelId !== undefined ? { librarianChatModelId: body.librarianChatModelId } : {}),
          ...(body.librarianRefineProviderId !== undefined ? { librarianRefineProviderId: body.librarianRefineProviderId } : {}),
          ...(body.librarianRefineModelId !== undefined ? { librarianRefineModelId: body.librarianRefineModelId } : {}),
          ...(body.autoApplyLibrarianSuggestions !== undefined ? { autoApplyLibrarianSuggestions: body.autoApplyLibrarianSuggestions } : {}),
          ...(body.contextOrderMode !== undefined ? { contextOrderMode: body.contextOrderMode } : {}),
          ...(body.fragmentOrder !== undefined ? { fragmentOrder: body.fragmentOrder } : {}),
          ...(body.enabledBuiltinTools !== undefined ? { enabledBuiltinTools: body.enabledBuiltinTools } : {}),
          ...(body.contextCompact !== undefined ? { contextCompact: body.contextCompact } : {}),
          ...(body.summaryCompact !== undefined ? { summaryCompact: body.summaryCompact } : {}),
          ...(body.enableHierarchicalSummary !== undefined ? { enableHierarchicalSummary: body.enableHierarchicalSummary } : {}),
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
        librarianProviderId: t.Optional(t.Union([t.String(), t.Null()])),
        librarianModelId: t.Optional(t.Union([t.String(), t.Null()])),
        characterChatProviderId: t.Optional(t.Union([t.String(), t.Null()])),
        characterChatModelId: t.Optional(t.Union([t.String(), t.Null()])),
        proseTransformProviderId: t.Optional(t.Union([t.String(), t.Null()])),
        proseTransformModelId: t.Optional(t.Union([t.String(), t.Null()])),
        librarianChatProviderId: t.Optional(t.Union([t.String(), t.Null()])),
        librarianChatModelId: t.Optional(t.Union([t.String(), t.Null()])),
        librarianRefineProviderId: t.Optional(t.Union([t.String(), t.Null()])),
        librarianRefineModelId: t.Optional(t.Union([t.String(), t.Null()])),
        autoApplyLibrarianSuggestions: t.Optional(t.Boolean()),
        contextOrderMode: t.Optional(t.Union([t.Literal('simple'), t.Literal('advanced')])),
        fragmentOrder: t.Optional(t.Array(t.String())),
        enabledBuiltinTools: t.Optional(t.Array(t.String())),
        contextCompact: t.Optional(t.Object({
          type: t.Union([t.Literal('proseLimit'), t.Literal('maxTokens'), t.Literal('maxCharacters')]),
          value: t.Number(),
        })),
        summaryCompact: t.Optional(t.Object({
          maxCharacters: t.Number(),
          targetCharacters: t.Number(),
        })),
        enableHierarchicalSummary: t.Optional(t.Boolean()),
      }),
    })

    // --- Branches ---
    .get('/stories/:storyId/branches', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      return getBranchesIndex(dataDir, params.storyId)
    })

    .post('/stories/:storyId/branches', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      try {
        const branch = await createBranch(
          dataDir,
          params.storyId,
          body.name,
          body.parentBranchId,
          body.forkAfterIndex,
        )
        return branch
      } catch (err) {
        set.status = 400
        return { error: err instanceof Error ? err.message : 'Failed to create branch' }
      }
    }, {
      body: t.Object({
        name: t.String(),
        parentBranchId: t.String(),
        forkAfterIndex: t.Optional(t.Number()),
      }),
    })

    .patch('/stories/:storyId/branches/active', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      try {
        await switchActiveBranch(dataDir, params.storyId, body.branchId)
        return { ok: true }
      } catch (err) {
        set.status = 400
        return { error: err instanceof Error ? err.message : 'Failed to switch branch' }
      }
    }, {
      body: t.Object({
        branchId: t.String(),
      }),
    })

    .put('/stories/:storyId/branches/:branchId', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      try {
        const branch = await renameBranch(dataDir, params.storyId, params.branchId, body.name)
        return branch
      } catch (err) {
        set.status = 400
        return { error: err instanceof Error ? err.message : 'Failed to rename branch' }
      }
    }, {
      body: t.Object({
        name: t.String(),
      }),
    })

    .delete('/stories/:storyId/branches/:branchId', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      try {
        await deleteBranch(dataDir, params.storyId, params.branchId)
        return { ok: true }
      } catch (err) {
        set.status = 400
        return { error: err instanceof Error ? err.message : 'Failed to delete branch' }
      }
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
        tags: body.tags ?? [],
        refs: [],
        sticky: registry.getType(body.type)?.stickyByDefault ?? false,
        placement: 'user',
        createdAt: now,
        updatedAt: now,
        archived: false,
        order: 0,
        meta: body.meta ?? {},
        version: 1,
        versions: [],
      }
      await createFragment(dataDir, params.storyId, fragment)
      return fragment
    }, {
      body: t.Object({
        type: t.String(),
        name: t.String(),
        description: t.String(),
        content: t.String(),
        tags: t.Optional(t.Array(t.String())),
        meta: t.Optional(t.Record(t.String(), t.Unknown())),
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
      const requestLogger = logger.child({ storyId: params.storyId, extra: { fragmentId: params.fragmentId } })
      const existing = await getFragment(
        dataDir,
        params.storyId,
        params.fragmentId
      )
      if (!existing) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      const versioned = await updateFragmentVersioned(
        dataDir,
        params.storyId,
        params.fragmentId,
        {
          name: body.name,
          description: body.description,
          content: body.content,
        },
        { reason: 'manual-update' },
      )
      if (!versioned) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      const updated: Fragment = {
        ...versioned,
        ...(body.sticky !== undefined ? { sticky: body.sticky } : {}),
        ...(body.order !== undefined ? { order: body.order } : {}),
        ...(body.placement !== undefined ? { placement: body.placement } : {}),
        ...(body.meta !== undefined ? { meta: body.meta } : {}),
        updatedAt: new Date().toISOString(),
      }
      await updateFragment(dataDir, params.storyId, updated)

      if (existing.type === 'prose' && hasMaterialProseChange(existing, updated)) {
        Promise.resolve(triggerLibrarian(dataDir, params.storyId, updated)).catch((err) => {
          requestLogger.error('triggerLibrarian failed after prose update', {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }

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
      const requestLogger = logger.child({ storyId: params.storyId, extra: { fragmentId: params.fragmentId } })
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
      const updated = await updateFragmentVersioned(
        dataDir,
        params.storyId,
        params.fragmentId,
        { content: newContent },
        { reason: 'manual-edit' },
      )
      if (!updated) {
        set.status = 404
        return { error: 'Fragment not found' }
      }

      if (existing.type === 'prose' && hasMaterialProseChange(existing, updated)) {
        Promise.resolve(triggerLibrarian(dataDir, params.storyId, updated)).catch((err) => {
          requestLogger.error('triggerLibrarian failed after prose edit', {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }

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

    .get('/stories/:storyId/fragments/:fragmentId/versions', async ({ params, set }) => {
      const versions = await listFragmentVersions(dataDir, params.storyId, params.fragmentId)
      if (!versions) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      return { versions }
    })

    .post('/stories/:storyId/fragments/:fragmentId/versions/:version/revert', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const targetVersion = Number.parseInt(params.version, 10)
      if (Number.isNaN(targetVersion) || targetVersion < 1) {
        set.status = 422
        return { error: 'Invalid version' }
      }
      const fragment = await getFragment(dataDir, params.storyId, params.fragmentId)
      if (!fragment) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      const updated = await revertFragmentToVersion(dataDir, params.storyId, params.fragmentId, targetVersion)
      if (!updated) {
        set.status = 422
        return { error: `Version ${targetVersion} not found` }
      }
      return updated
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
    .get('/stories/:storyId/fragments/:fragmentId/tags', async ({ params, set }) => {
      const fragment = await getFragment(dataDir, params.storyId, params.fragmentId)
      if (!fragment) {
        set.status = 404
        return { error: 'Fragment not found' }
      }
      return { tags: fragment.tags }
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

    // --- Block Config ---
    .get('/stories/:storyId/blocks', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const config = await getBlockConfig(dataDir, params.storyId)
      // Build default blocks for metadata
      const ctxState = await buildContextState(dataDir, params.storyId, '(preview)')
      const defaultBlocks = createDefaultBlocks(ctxState)
      const builtinBlocks = defaultBlocks.map(b => ({
        id: b.id,
        role: b.role,
        order: b.order,
        source: b.source,
        contentPreview: b.content.slice(0, 200),
      }))
      return { config, builtinBlocks }
    })

    .get('/stories/:storyId/blocks/preview', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const ctxState = await buildContextState(dataDir, params.storyId, '(preview)')
      let blocks = createDefaultBlocks(ctxState)
      const blockConfig = await getBlockConfig(dataDir, params.storyId)
      blocks = applyBlockConfig(blocks, blockConfig, ctxState)
      const messages = compileBlocks(blocks)
      const blocksMeta = blocks
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === 'system' ? -1 : 1
          return a.order - b.order
        })
        .map(b => ({ id: b.id, name: b.id, role: b.role }))
      return { messages, blocks: blocksMeta, blockCount: blocks.length }
    })

    .post('/stories/:storyId/blocks/custom', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const parsed = CustomBlockDefinitionSchema.safeParse(body)
      if (!parsed.success) {
        set.status = 422
        return { error: 'Invalid block definition', details: parsed.error.issues }
      }
      const config = await addCustomBlock(dataDir, params.storyId, parsed.data)
      return config
    })

    .put('/stories/:storyId/blocks/custom/:blockId', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const config = await updateCustomBlock(dataDir, params.storyId, params.blockId, body as Record<string, unknown>)
      if (!config) {
        set.status = 404
        return { error: 'Custom block not found' }
      }
      return config
    })

    .delete('/stories/:storyId/blocks/custom/:blockId', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const config = await deleteCustomBlock(dataDir, params.storyId, params.blockId)
      return config
    })

    .patch('/stories/:storyId/blocks/config', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const { overrides, blockOrder } = body as { overrides?: Record<string, unknown>; blockOrder?: string[] }
      const config = await updateBlockOverrides(
        dataDir,
        params.storyId,
        (overrides ?? {}) as Record<string, import('./blocks/schema').BlockOverride>,
        blockOrder,
      )
      return config
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
      const encoder = new TextEncoder()
      const encodedStream = stream.pipeThrough(new TransformStream<string, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(encoder.encode(chunk))
        },
      }))
      return new Response(encodedStream, {
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

        const encoder = new TextEncoder()
        const encodedStream = eventStream.pipeThrough(new TransformStream<string, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk))
          },
        }))

        return new Response(encodedStream, {
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

    // --- Character Chat ---
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

      // Preferred path: version history
      const reverted = await revertFragmentToVersion(dataDir, params.storyId, params.fragmentId)
      if (reverted) {
        return reverted
      }

      // Legacy fallback: old previousContent meta
      const previousContent = fragment.meta?.previousContent
      if (typeof previousContent !== 'string') {
        set.status = 422
        return { error: 'No previous version to revert to' }
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

      // Merge fragment tools + plugin tools
      const fragmentTools = createFragmentTools(dataDir, params.storyId, { readOnly: true })
      const enabledBuiltinTools = story.settings.enabledBuiltinTools
      const filteredFragmentTools = enabledBuiltinTools === undefined
        ? fragmentTools
        : Object.fromEntries(
            Object.entries(fragmentTools).filter(([toolName]) => enabledBuiltinTools.includes(toolName)),
          )
      const { tools: pluginTools, origins: pluginToolOrigins } = collectPluginToolsWithOrigin(enabledPlugins, dataDir, params.storyId)
      const tools = { ...filteredFragmentTools, ...pluginTools }
      requestLogger.info('Tools prepared', { toolCount: Object.keys(tools).length })

      // Extract plugin tool descriptions for context (fragment tools are listed from registry)
      const extraTools = Object.entries(pluginTools).map(([name, t]) => ({
        name,
        description: (t as { description?: string }).description ?? '',
        pluginName: pluginToolOrigins[name],
      }))

      let blocks = createDefaultBlocks(ctxState, extraTools.length > 0 ? { extraTools } : undefined)
      const blockConfig = await getBlockConfig(dataDir, params.storyId)
      blocks = applyBlockConfig(blocks, blockConfig, ctxState)
      blocks = await runBeforeBlocks(enabledPlugins, blocks)
      let messages = compileBlocks(blocks)
      messages = await runBeforeGeneration(enabledPlugins, messages)
      requestLogger.info('BeforeGeneration hooks completed', { messageCount: messages.length })

      requestLogger.info('Starting LLM stream...')
      const { model, modelId: resolvedModelId } = await getModel(dataDir, params.storyId)
      requestLogger.info('Resolved model', { resolvedModelId })
      const writerAgent = createWriterAgent({
        model,
        tools,
        maxSteps: story.settings.maxSteps ?? 10,
      })
      const result = await writerAgent.stream({
        messages,
      })

      // Build NDJSON event stream from fullStream (same pattern as librarian chat)
      const fullStream = result.fullStream

      let fullText = ''
      let fullReasoning = ''
      const toolCalls: ToolCallLog[] = []
      let lastFinishReason = 'unknown'
      let stepCount = 0

      // Completion promise resolved when the stream ends — used by save path
      let completionResolve: ((val: void) => void) | null = null
      if (body.saveResult) {
        new Promise<void>((resolve) => { completionResolve = resolve })
      }

      const eventStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder()
          try {
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
            controller.error(err)
          }

          // Run save operation after stream completes
          if (body.saveResult) {
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
                const rawUsage = await result.totalUsage
                if (rawUsage && typeof rawUsage.inputTokens === 'number') {
                  totalUsage = { inputTokens: rawUsage.inputTokens, outputTokens: rawUsage.outputTokens ? rawUsage.outputTokens : 0 }
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
                ...(totalUsage ? { totalUsage } : {}),
                ...(fullReasoning ? { reasoning: fullReasoning } : {}),
              }
              await saveGenerationLog(dataDir, params.storyId, log)
              requestLogger.info('Generation log saved', { logId, stepCount, finishReason, stepsExceeded })
            } catch (err) {
              requestLogger.error('Error saving generation result', { error: err instanceof Error ? err.message : String(err) })
            }
            completionResolve?.()
          }
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
                type: fragment.type,
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

    // --- Chapters (marker fragments in prose chain) ---
    .post('/stories/:storyId/chapters', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const now = new Date().toISOString()
      const id = generateFragmentId('marker')
      const fragment = await createFragment(dataDir, params.storyId, {
        id,
        type: 'marker',
        name: body.name,
        description: body.description ?? '',
        content: body.content ?? '',
        tags: [],
        refs: [],
        sticky: false,
        placement: 'user',
        createdAt: now,
        updatedAt: now,
        order: 0,
        meta: {},
      })

      await insertProseSection(dataDir, params.storyId, id, body.position)

      return { fragment }
    }, {
      body: t.Object({
        name: t.String(),
        description: t.Optional(t.String()),
        content: t.Optional(t.String()),
        position: t.Number(),
      }),
    })

    .post('/stories/:storyId/chapters/:fragmentId/summarize', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const marker = await getFragment(dataDir, params.storyId, params.fragmentId)
      if (!marker || marker.type !== 'marker') {
        set.status = 404
        return { error: 'Chapter marker not found' }
      }

      try {
        const { output, trace: agentTrace } = await invokeAgent<{
          summary: string
          reasoning: string
          modelId: string
          durationMs: number
          trace: Array<{ type: string; [key: string]: unknown }>
        }>({
          dataDir,
          storyId: params.storyId,
          agentName: 'chapters.summarize',
          input: { fragmentId: params.fragmentId },
        })
        return {
          summary: output.summary,
          reasoning: output.reasoning,
          modelId: output.modelId,
          durationMs: output.durationMs,
          trace: output.trace,
          agentTrace,
        }
      } catch (err) {
        set.status = 400
        return { error: err instanceof Error ? err.message : 'Failed to summarize chapter' }
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

    .post('/config/providers/:providerId/duplicate', async ({ params }) => {
      const config = await duplicateProviderConfig(dataDir, params.providerId)
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
        const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`
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
        const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`
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
        const url = /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
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
