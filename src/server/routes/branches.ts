import { Elysia, t } from 'elysia'
import { getStory } from '../fragments/storage'
import {
  getBranchesIndex,
  switchActiveBranch,
  createBranch,
  deleteBranch,
  renameBranch,
} from '../fragments/branches'

export function branchRoutes(dataDir: string) {
  return new Elysia()
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
}
