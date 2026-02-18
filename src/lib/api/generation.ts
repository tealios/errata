import { fetchEventStream } from './client'
import type { GenerationLogSummary, GenerationLog } from './types'

export const generation = {
  /** Stream prose generation (returns ReadableStream of ChatEvent) */
  stream: (storyId: string, input: string) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: false }),
  /** Generate and save as a new prose fragment */
  generateAndSave: (storyId: string, input: string) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: true }),
  /** Regenerate an existing fragment with a new prompt */
  regenerate: (storyId: string, fragmentId: string, input: string) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: true, mode: 'regenerate', fragmentId }),
  /** Refine an existing fragment with instructions */
  refine: (storyId: string, fragmentId: string, input: string) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: true, mode: 'refine', fragmentId }),
  /** List generation log summaries (newest first) */
  listLogs: (storyId: string) =>
    apiFetch<GenerationLogSummary[]>(`/stories/${storyId}/generation-logs`),
  /** Get a full generation log by ID */
  getLog: (storyId: string, logId: string) =>
    apiFetch<GenerationLog>(`/stories/${storyId}/generation-logs/${logId}`),
}

// Import apiFetch for the non-streaming methods
import { apiFetch } from './client'
