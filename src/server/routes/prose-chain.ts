import { Elysia, t } from 'elysia'
import {
  getStory,
  createFragment,
  getFragment,
  archiveFragment,
} from '../fragments/storage'
import {
  addProseSection,
  insertProseSection,
  getFullProseChain,
  switchActiveProse,
  removeProseSection,
} from '../fragments/prose-chain'
import { generateFragmentId } from '@/lib/fragment-ids'
import { invokeAgent } from '../agents'

export function proseChainRoutes(dataDir: string) {
  return new Elysia()
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
}
