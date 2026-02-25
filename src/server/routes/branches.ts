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
  return new Elysia({ detail: { tags: ['Branches'] } })
    .get('/stories/:storyId/branches', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      return getBranchesIndex(dataDir, params.storyId)
    }, {
      detail: { summary: 'List all branches' },
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
      detail: { summary: 'Create a new branch' },
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
      detail: { summary: 'Switch the active branch' },
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
      detail: { summary: 'Rename a branch' },
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
    }, {
      detail: { summary: 'Delete a branch' },
    })
}
