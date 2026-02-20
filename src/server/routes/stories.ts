import { Elysia, t } from 'elysia'
import {
  createStory,
  getStory,
  listStories,
  updateStory,
  deleteStory,
} from '../fragments/storage'
import { exportStoryAsZip, importStoryFromZip } from '../story-archive'
import type { StoryMeta } from '../fragments/schema'

export function storyRoutes(dataDir: string) {
  return new Elysia()
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
        coverImage: body.coverImage ?? null,
        summary: '',
        createdAt: now,
        updatedAt: now,
        settings: {
          outputFormat: 'markdown',
          enabledPlugins: [],
          summarizationThreshold: 4,
          maxSteps: 10,
          modelOverrides: {},
          autoApplyLibrarianSuggestions: false,
          contextOrderMode: 'simple' as const,
          fragmentOrder: [],
          contextCompact: { type: 'proseLimit' as const, value: 10 },
          summaryCompact: { maxCharacters: 12000, targetCharacters: 9000 },
          enableHierarchicalSummary: false,
        },
      }
      await createStory(dataDir, story)
      return story
    }, {
      body: t.Object({
        name: t.String(),
        description: t.String(),
        coverImage: t.Optional(t.Union([t.String(), t.Null()])),
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
        ...(body.coverImage !== undefined ? { coverImage: body.coverImage } : {}),
        updatedAt: new Date().toISOString(),
      }
      await updateStory(dataDir, updated)
      return updated
    }, {
      body: t.Object({
        name: t.String(),
        description: t.String(),
        summary: t.Optional(t.String()),
        coverImage: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    })

    .delete('/stories/:storyId', async ({ params }) => {
      await deleteStory(dataDir, params.storyId)
      return { ok: true }
    })

    // --- Story Export/Import ---
    .get('/stories/:storyId/export', async ({ params, set }) => {
      try {
        const { buffer, filename } = await exportStoryAsZip(dataDir, params.storyId)
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
          ...(body.modelOverrides !== undefined ? { modelOverrides: body.modelOverrides } : {}),
          // Legacy fields (kept for backward compat with older clients)
          ...(body.providerId !== undefined ? { providerId: body.providerId } : {}),
          ...(body.modelId !== undefined ? { modelId: body.modelId } : {}),
          ...(body.autoApplyLibrarianSuggestions !== undefined ? { autoApplyLibrarianSuggestions: body.autoApplyLibrarianSuggestions } : {}),
          ...(body.contextOrderMode !== undefined ? { contextOrderMode: body.contextOrderMode } : {}),
          ...(body.fragmentOrder !== undefined ? { fragmentOrder: body.fragmentOrder } : {}),
          ...(body.contextCompact !== undefined ? { contextCompact: body.contextCompact } : {}),
          ...(body.summaryCompact !== undefined ? { summaryCompact: body.summaryCompact } : {}),
          ...(body.enableHierarchicalSummary !== undefined ? { enableHierarchicalSummary: body.enableHierarchicalSummary } : {}),
          ...(body.guidedContinuePrompt !== undefined ? { guidedContinuePrompt: body.guidedContinuePrompt } : {}),
          ...(body.guidedSceneSettingPrompt !== undefined ? { guidedSceneSettingPrompt: body.guidedSceneSettingPrompt } : {}),
          ...(body.guidedSuggestPrompt !== undefined ? { guidedSuggestPrompt: body.guidedSuggestPrompt } : {}),
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
        modelOverrides: t.Optional(t.Record(t.String(), t.Object({
          providerId: t.Optional(t.Union([t.String(), t.Null()])),
          modelId: t.Optional(t.Union([t.String(), t.Null()])),
        }))),
        // Legacy fields (backward compat)
        providerId: t.Optional(t.Union([t.String(), t.Null()])),
        modelId: t.Optional(t.Union([t.String(), t.Null()])),
        autoApplyLibrarianSuggestions: t.Optional(t.Boolean()),
        contextOrderMode: t.Optional(t.Union([t.Literal('simple'), t.Literal('advanced')])),
        fragmentOrder: t.Optional(t.Array(t.String())),
        contextCompact: t.Optional(t.Object({
          type: t.Union([t.Literal('proseLimit'), t.Literal('maxTokens'), t.Literal('maxCharacters')]),
          value: t.Number(),
        })),
        summaryCompact: t.Optional(t.Object({
          maxCharacters: t.Number(),
          targetCharacters: t.Number(),
        })),
        enableHierarchicalSummary: t.Optional(t.Boolean()),
        guidedContinuePrompt: t.Optional(t.String()),
        guidedSceneSettingPrompt: t.Optional(t.String()),
        guidedSuggestPrompt: t.Optional(t.String()),
      }),
    })
}
