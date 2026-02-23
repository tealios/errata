import { apiFetch } from './client'

export interface UsageEntry {
  inputTokens: number
  outputTokens: number
  calls: number
}

export interface SourceUsage extends UsageEntry {
  byModel: Record<string, UsageEntry>
}

export interface UsageSnapshot {
  sources: Record<string, SourceUsage>
  total: UsageEntry
  byModel: Record<string, UsageEntry>
}

export interface TokenUsageResponse {
  session: UsageSnapshot
  project: UsageSnapshot
}

export const tokenUsage = {
  get: (storyId: string) =>
    apiFetch<TokenUsageResponse>(`/stories/${storyId}/token-usage`),
}
