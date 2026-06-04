import { fetchEventStream } from './client'
import type { GenerationLogSummary, GenerationLog, SuggestionDirection, Clarification } from './types'

/** Optional clarify-before-generate answers carried into a (re)generation request. */
export interface ClarifyOpts {
  clarifications?: Clarification[]
  clarifyRound?: number
}

function clarifyBody(opts?: ClarifyOpts): Record<string, unknown> {
  if (!opts?.clarifications?.length) return {}
  return { clarifications: opts.clarifications, clarifyRound: opts.clarifyRound ?? 0 }
}

export const generation = {
  /** Stream prose generation (returns ReadableStream of ChatEvent) */
  stream: (storyId: string, input: string, signal?: AbortSignal, opts?: ClarifyOpts) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: false, ...clarifyBody(opts) }, signal),
  /** Generate and save as a new prose fragment */
  generateAndSave: (storyId: string, input: string, signal?: AbortSignal, opts?: ClarifyOpts) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: true, ...clarifyBody(opts) }, signal),
  /** Regenerate an existing fragment with a new prompt */
  regenerate: (storyId: string, fragmentId: string, input: string, signal?: AbortSignal, opts?: ClarifyOpts) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: true, mode: 'regenerate', fragmentId, ...clarifyBody(opts) }, signal),
  /** Refine an existing fragment with instructions */
  refine: (storyId: string, fragmentId: string, input: string, signal?: AbortSignal, opts?: ClarifyOpts) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: true, mode: 'refine', fragmentId, ...clarifyBody(opts) }, signal),
  /** Get AI-generated story direction suggestions */
  suggestDirections: (storyId: string, count?: number) =>
    apiFetch<{ suggestions: SuggestionDirection[] }>(
      `/stories/${storyId}/suggest-directions`,
      { method: 'POST', body: JSON.stringify({ count }) },
    ),
  /** List generation log summaries (newest first) */
  listLogs: (storyId: string) =>
    apiFetch<GenerationLogSummary[]>(`/stories/${storyId}/generation-logs`),
  /** Get a full generation log by ID */
  getLog: (storyId: string, logId: string) =>
    apiFetch<GenerationLog>(`/stories/${storyId}/generation-logs/${logId}`),
}

// Import apiFetch for the non-streaming methods
import { apiFetch } from './client'
