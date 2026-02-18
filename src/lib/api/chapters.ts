import { apiFetch } from './client'
import type { Fragment } from './types'

export interface ChapterSummarizeResponse {
  summary: string
  reasoning: string
  modelId: string
  durationMs: number
  trace: Array<{ type: string; [key: string]: unknown }>
  agentTrace: Array<{ runId: string; agentName: string; durationMs: number; status: string }>
}

export const chapters = {
  create: (storyId: string, data: { name: string; description?: string; content?: string; position: number }) =>
    apiFetch<{ fragment: Fragment }>(`/stories/${storyId}/chapters`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  summarize: (storyId: string, fragmentId: string) =>
    apiFetch<ChapterSummarizeResponse>(`/stories/${storyId}/chapters/${fragmentId}/summarize`, {
      method: 'POST',
    }),
}
