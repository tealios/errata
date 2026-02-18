import { apiFetch } from './client'
import type { BranchMeta, BranchesIndex } from './types'

export const branches = {
  list(storyId: string): Promise<BranchesIndex> {
    return apiFetch(`/stories/${storyId}/branches`)
  },

  create(storyId: string, data: { name: string; parentBranchId: string; forkAfterIndex?: number }): Promise<BranchMeta> {
    return apiFetch(`/stories/${storyId}/branches`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  switchActive(storyId: string, branchId: string): Promise<{ ok: boolean }> {
    return apiFetch(`/stories/${storyId}/branches/active`, {
      method: 'PATCH',
      body: JSON.stringify({ branchId }),
    })
  },

  rename(storyId: string, branchId: string, name: string): Promise<BranchMeta> {
    return apiFetch(`/stories/${storyId}/branches/${branchId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    })
  },

  delete(storyId: string, branchId: string): Promise<{ ok: boolean }> {
    return apiFetch(`/stories/${storyId}/branches/${branchId}`, {
      method: 'DELETE',
    })
  },
}
