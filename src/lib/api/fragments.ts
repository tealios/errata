import { apiFetch } from './client'
import type { Fragment, FragmentVersion } from './types'

export const fragments = {
  list: (storyId: string, type?: string) =>
    apiFetch<Fragment[]>(`/stories/${storyId}/fragments${type ? `?type=${type}` : ''}`),
  get: (storyId: string, fragmentId: string) =>
    apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}`),
  create: (storyId: string, data: { type: string; name: string; description: string; content: string; id?: string; tags?: string[]; meta?: Record<string, unknown> }) =>
    apiFetch<Fragment>(`/stories/${storyId}/fragments`, { method: 'POST', body: JSON.stringify(data) }),
  update: (storyId: string, fragmentId: string, data: { name: string; description: string; content: string; sticky?: boolean; order?: number; placement?: 'system' | 'user'; meta?: Record<string, unknown> }) =>
    apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  edit: (storyId: string, fragmentId: string, data: { oldText: string; newText: string }) =>
    apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (storyId: string, fragmentId: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/${fragmentId}`, { method: 'DELETE' }),
  types: (storyId: string) =>
    apiFetch<import('./types').FragmentTypeInfo[]>(`/stories/${storyId}/fragment-types`),
  // Tags
  getTags: (storyId: string, fragmentId: string) =>
    apiFetch<{ tags: string[] }>(`/stories/${storyId}/fragments/${fragmentId}/tags`),
  addTag: (storyId: string, fragmentId: string, tag: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/${fragmentId}/tags`, {
      method: 'POST', body: JSON.stringify({ tag }),
    }),
  removeTag: (storyId: string, fragmentId: string, tag: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/${fragmentId}/tags`, {
      method: 'DELETE', body: JSON.stringify({ tag }),
    }),
  // Refs
  getRefs: (storyId: string, fragmentId: string) =>
    apiFetch<{ refs: string[]; backRefs: string[] }>(`/stories/${storyId}/fragments/${fragmentId}/refs`),
  addRef: (storyId: string, fragmentId: string, targetId: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/${fragmentId}/refs`, {
      method: 'POST', body: JSON.stringify({ targetId }),
    }),
  removeRef: (storyId: string, fragmentId: string, targetId: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/${fragmentId}/refs`, {
      method: 'DELETE', body: JSON.stringify({ targetId }),
    }),
  // Sticky
  toggleSticky: (storyId: string, fragmentId: string, sticky: boolean) =>
    apiFetch<{ ok: boolean; sticky: boolean }>(`/stories/${storyId}/fragments/${fragmentId}/sticky`, {
      method: 'PATCH', body: JSON.stringify({ sticky }),
    }),
  // Revert
  revert: (storyId: string, fragmentId: string) =>
    apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}/revert`, { method: 'POST' }),
  listVersions: (storyId: string, fragmentId: string) =>
    apiFetch<{ versions: FragmentVersion[] }>(`/stories/${storyId}/fragments/${fragmentId}/versions`),
  revertToVersion: (storyId: string, fragmentId: string, version: number) =>
    apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}/versions/${version}/revert`, { method: 'POST' }),
  // Reorder (bulk)
  reorder: (storyId: string, items: Array<{ id: string; order: number }>) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ items }),
    }),
  // Placement
  setPlacement: (storyId: string, fragmentId: string, placement: 'system' | 'user') =>
    apiFetch<{ ok: boolean; placement: string }>(`/stories/${storyId}/fragments/${fragmentId}/placement`, {
      method: 'PATCH',
      body: JSON.stringify({ placement }),
    }),
  // Archive / Restore
  archive: (storyId: string, fragmentId: string) =>
    apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}/archive`, { method: 'POST' }),
  restore: (storyId: string, fragmentId: string) =>
    apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}/restore`, { method: 'POST' }),
  listArchived: async (storyId: string) => {
    const all = await apiFetch<Fragment[]>(`/stories/${storyId}/fragments?includeArchived=true`)
    return all.filter((f) => f.archived)
  },
}
