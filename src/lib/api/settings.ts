import { apiFetch } from './client'
import type { StoryMeta } from './types'

export const settings = {
  update: (storyId: string, data: {
    enabledPlugins?: string[]
    outputFormat?: 'plaintext' | 'markdown'
    summarizationThreshold?: number
    maxSteps?: number
    providerId?: string | null
    modelId?: string | null
    librarianProviderId?: string | null
    librarianModelId?: string | null
    characterChatProviderId?: string | null
    characterChatModelId?: string | null
    proseTransformProviderId?: string | null
    proseTransformModelId?: string | null
    librarianChatProviderId?: string | null
    librarianChatModelId?: string | null
    librarianRefineProviderId?: string | null
    librarianRefineModelId?: string | null
    autoApplyLibrarianSuggestions?: boolean
    contextOrderMode?: 'simple' | 'advanced'
    fragmentOrder?: string[]
    enabledBuiltinTools?: string[]
    contextCompact?: { type: 'proseLimit' | 'maxTokens' | 'maxCharacters'; value: number }
    summaryCompact?: { maxCharacters: number; targetCharacters: number }
    enableHierarchicalSummary?: boolean
  }) =>
    apiFetch<StoryMeta>(`/stories/${storyId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}
