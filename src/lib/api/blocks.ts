import { apiFetch } from './client'
import type { BlockConfig, BlocksResponse, BlockPreviewResponse, CustomBlockDefinition, BlockOverride, ExportedConfigs, ImportConfigsPayload } from './types'

export const blocks = {
  get: (storyId: string) =>
    apiFetch<BlocksResponse>(`/stories/${storyId}/blocks`),

  preview: (storyId: string) =>
    apiFetch<BlockPreviewResponse>(`/stories/${storyId}/blocks/preview`),

  createCustom: (storyId: string, data: CustomBlockDefinition) =>
    apiFetch<BlockConfig>(`/stories/${storyId}/blocks/custom`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCustom: (storyId: string, blockId: string, data: Partial<Omit<CustomBlockDefinition, 'id'>>) =>
    apiFetch<BlockConfig>(`/stories/${storyId}/blocks/custom/${blockId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteCustom: (storyId: string, blockId: string) =>
    apiFetch<BlockConfig>(`/stories/${storyId}/blocks/custom/${blockId}`, {
      method: 'DELETE',
    }),

  updateConfig: (storyId: string, data: { overrides?: Record<string, BlockOverride>; blockOrder?: string[] }) =>
    apiFetch<BlockConfig>(`/stories/${storyId}/blocks/config`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  evalScript: (storyId: string, content: string) =>
    apiFetch<{ result: string | null; error: string | null }>(
      `/stories/${storyId}/blocks/eval-script`,
      { method: 'POST', body: JSON.stringify({ content }) },
    ),

  exportConfigs: (storyId: string) =>
    apiFetch<ExportedConfigs>(`/stories/${storyId}/export-configs`),

  importConfigs: (storyId: string, data: ImportConfigsPayload) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/import-configs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}
