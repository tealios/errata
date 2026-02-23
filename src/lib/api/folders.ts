import { apiFetch } from './client'

export interface Folder {
  id: string
  name: string
  order: number
  color?: string
}

/** Fragment ID → Folder ID */
export type FolderAssignments = Record<string, string>

export interface FoldersResponse {
  folders: Folder[]
  assignments: FolderAssignments
}

export const folders = {
  list: (storyId: string) =>
    apiFetch<FoldersResponse>(`/stories/${storyId}/folders`),
  create: (storyId: string, name: string) =>
    apiFetch<Folder>(`/stories/${storyId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  update: (storyId: string, folderId: string, data: { name?: string; color?: string | null }) =>
    apiFetch<Folder>(`/stories/${storyId}/folders/${folderId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (storyId: string, folderId: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/folders/${folderId}`, {
      method: 'DELETE',
    }),
  reorder: (storyId: string, items: Array<{ id: string; order: number }>) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/folders/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ items }),
    }),
  assignFragment: (storyId: string, fragmentId: string, folderId: string | null) =>
    apiFetch<{ ok: boolean; folderId: string | null }>(`/stories/${storyId}/fragments/${fragmentId}/folder`, {
      method: 'PATCH',
      body: JSON.stringify({ folderId }),
    }),
}
