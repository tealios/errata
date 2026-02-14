import { Elysia, t } from 'elysia'
import { streamText } from 'ai'
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
import { buildContext } from './llm/context-builder'
import { createFragmentTools } from './llm/tools'
import { defaultModel } from './llm/client'
import type { StoryMeta, Fragment } from './fragments/schema'

const DATA_DIR = process.env.DATA_DIR ?? './data'

export function createApp(dataDir: string = DATA_DIR) {
  return new Elysia({ prefix: '/api' })
    .get('/health', () => ({ status: 'ok' }))

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

      const messages = await buildContext(dataDir, params.storyId, body.input)
      const tools = createFragmentTools(dataDir, params.storyId)

      const result = streamText({
        model: defaultModel,
        messages,
        tools,
        toolChoice: 'auto',
      })

      // If saveResult is true, consume the text and save as a new prose fragment
      if (body.saveResult) {
        const text = await result.text
        const now = new Date().toISOString()
        const id = generateFragmentId('prose')
        const fragment: Fragment = {
          id,
          type: 'prose',
          name: `Generated ${new Date().toLocaleDateString()}`,
          description: body.input.slice(0, 50),
          content: text,
          tags: [],
          refs: [],
          sticky: false,
          createdAt: now,
          updatedAt: now,
          order: 0,
          meta: { generatedFrom: body.input },
        }
        await createFragment(dataDir, params.storyId, fragment)

        return new Response(text, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }

      // Stream the response
      return result.toTextStreamResponse()
    }, {
      body: t.Object({
        input: t.String(),
        saveResult: t.Optional(t.Boolean()),
      }),
    })
}

export const app = createApp()

export type App = typeof app
