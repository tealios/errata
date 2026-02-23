import { Elysia, t } from 'elysia'
import {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  reorderFolders,
  getAssignments,
  assignFragment,
} from '../fragments/folders'

export function folderRoutes(dataDir: string) {
  return new Elysia()
    .get('/stories/:storyId/folders', async ({ params }) => {
      const [folderList, assignments] = await Promise.all([
        listFolders(dataDir, params.storyId),
        getAssignments(dataDir, params.storyId),
      ])
      return { folders: folderList, assignments }
    })

    .post('/stories/:storyId/folders', async ({ params, body }) => {
      return createFolder(dataDir, params.storyId, body.name)
    }, {
      body: t.Object({ name: t.String() }),
    })

    .put('/stories/:storyId/folders/:folderId', async ({ params, body, set }) => {
      const result = await updateFolder(dataDir, params.storyId, params.folderId, body)
      if (!result) {
        set.status = 404
        return { error: 'Folder not found' }
      }
      return result
    }, {
      body: t.Object({
        name: t.Optional(t.String()),
        color: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    })

    .delete('/stories/:storyId/folders/:folderId', async ({ params, set }) => {
      const ok = await deleteFolder(dataDir, params.storyId, params.folderId)
      if (!ok) {
        set.status = 404
        return { error: 'Folder not found' }
      }
      return { ok: true }
    })

    .patch('/stories/:storyId/folders/reorder', async ({ params, body }) => {
      await reorderFolders(dataDir, params.storyId, body.items)
      return { ok: true }
    }, {
      body: t.Object({
        items: t.Array(t.Object({
          id: t.String(),
          order: t.Number(),
        })),
      }),
    })

    .patch('/stories/:storyId/fragments/:fragmentId/folder', async ({ params, body }) => {
      await assignFragment(dataDir, params.storyId, params.fragmentId, body.folderId)
      return { ok: true, folderId: body.folderId }
    }, {
      body: t.Object({
        folderId: t.Union([t.String(), t.Null()]),
      }),
    })
}
