import { apiFetch } from './client'
import type { StoryMeta } from './types'

export const settings = {
  update: (storyId: string, data: {
    enabledPlugins?: string[]
    outputFormat?: 'plaintext' | 'markdown'
    summarizationThreshold?: number
    maxSteps?: number
    modelOverrides?: Record<string, { providerId?: string | null; modelId?: string | null }>
    // Legacy fields (backward compat)
    providerId?: string | null
    modelId?: string | null
    generationMode?: 'standard' | 'prewriter'
    autoApplyLibrarianSuggestions?: boolean
    contextOrderMode?: 'simple' | 'advanced'
    fragmentOrder?: string[]
    contextCompact?: { type: 'proseLimit' | 'maxTokens' | 'maxCharacters'; value: number }
    summaryCompact?: { maxCharacters: number; targetCharacters: number }
    enableHierarchicalSummary?: boolean
    guidedContinuePrompt?: string
    guidedSceneSettingPrompt?: string
    guidedSuggestPrompt?: string
  }) =>
    apiFetch<StoryMeta>(`/stories/${storyId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}
