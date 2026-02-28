import { apiFetch } from './client'
import type { ProseChain } from './types'

export const proseChain = {
  get: (storyId: string) =>
    apiFetch<ProseChain>(`/stories/${storyId}/prose-chain`),
  addSection: (storyId: string, fragmentId: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/prose-chain`, {
      method: 'POST',
      body: JSON.stringify({ fragmentId }),
    }),
  switchVariation: (storyId: string, sectionIndex: number, fragmentId: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/prose-chain/${sectionIndex}/switch`, {
      method: 'POST',
      body: JSON.stringify({ fragmentId }),
    }),
  removeSection: (storyId: string, sectionIndex: number) =>
    apiFetch<{ ok: boolean; archivedFragmentIds: string[] }>(`/stories/${storyId}/prose-chain/${sectionIndex}`, {
      method: 'DELETE',
    }),
  reorder: (storyId: string, order: number[]) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/prose-chain/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ order }),
    }),
}
