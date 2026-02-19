import { Elysia, t } from 'elysia'
import {
  getStory,
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
} from '../fragments/storage'
import {
  addTag,
  removeTag,
  addRef,
  removeRef,
  getRefs,
  getBackRefs,
} from '../fragments/associations'
import { generateFragmentId } from '@/lib/fragment-ids'
import { registry } from '../fragments/registry'
import { triggerLibrarian } from '../librarian/scheduler'
import { createLogger } from '../logging'
import type { Fragment } from '../fragments/schema'

function hasMaterialProseChange(before: Fragment, after: Fragment): boolean {
  return before.name !== after.name
    || before.description !== after.description
    || before.content !== after.content
}

export function fragmentRoutes(dataDir: string) {
  const logger = createLogger('api:fragments', { dataDir })

  return new Elysia()
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

    // --- Fragment Revert (legacy + versioned) ---
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
}
