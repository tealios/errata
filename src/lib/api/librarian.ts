import { apiFetch, fetchEventStream, fetchGetEventStream } from './client'
import type {
  LibrarianState,
  LibrarianAnalysisSummary,
  LibrarianAnalysis,
  LibrarianAcceptSuggestionResponse,
  ChatHistory,
  ConversationMeta,
  AgentRunTraceRecord,
} from './types'

export const librarian = {
  getStatus: (storyId: string) =>
    apiFetch<LibrarianState>(`/stories/${storyId}/librarian/status`),
  getAnalysisIndex: (storyId: string) =>
    apiFetch<Record<string, string>>(`/stories/${storyId}/librarian/analysis-index`),
  analyze: (storyId: string, fragmentId: string) =>
    apiFetch<{ ok: boolean; fragmentId: string }>(`/stories/${storyId}/librarian/analyze`, {
      method: 'POST',
      body: JSON.stringify({ fragmentId }),
    }),
  listAnalyses: (storyId: string) =>
    apiFetch<LibrarianAnalysisSummary[]>(`/stories/${storyId}/librarian/analyses`),
  listAgentRuns: (storyId: string) =>
    apiFetch<AgentRunTraceRecord[]>(`/stories/${storyId}/librarian/agent-runs`),
  getAnalysis: (storyId: string, id: string) =>
    apiFetch<LibrarianAnalysis>(`/stories/${storyId}/librarian/analyses/${id}`),
  updateAnalysis: (storyId: string, analysisId: string, data: { summaryUpdate: string }) =>
    apiFetch<LibrarianAnalysis>(`/stories/${storyId}/librarian/analyses/${analysisId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  acceptSuggestion: (storyId: string, analysisId: string, index: number) =>
    apiFetch<LibrarianAcceptSuggestionResponse>(`/stories/${storyId}/librarian/analyses/${analysisId}/suggestions/${index}/accept`, { method: 'POST' }),
  dismissSuggestion: (storyId: string, analysisId: string, index: number) =>
    apiFetch<{ analysis: LibrarianAnalysis }>(`/stories/${storyId}/librarian/analyses/${analysisId}/suggestions/${index}/dismiss`, { method: 'POST' }),
  deleteAnalysis: (storyId: string, analysisId: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/librarian/analyses/${analysisId}`, { method: 'DELETE' }),
  clearAnalyses: (storyId: string, scope: 'stale' | 'all') =>
    apiFetch<{ removed: number }>(`/stories/${storyId}/librarian/analyses/clear`, {
      method: 'POST',
      body: JSON.stringify({ scope }),
    }),
  refine: (storyId: string, fragmentId: string, instructions?: string, signal?: AbortSignal) =>
    fetchEventStream(`/stories/${storyId}/librarian/refine`, { fragmentId, instructions }, signal),
  transformProseSelection: (
    storyId: string,
    fragmentId: string,
    operation: 'rewrite' | 'expand' | 'compress' | 'custom',
    selectedText: string,
    options?: { sourceContent?: string; contextBefore?: string; contextAfter?: string; instruction?: string; signal?: AbortSignal },
  ) => fetchEventStream(`/stories/${storyId}/librarian/prose-transform`, {
    fragmentId,
    operation,
    selectedText,
    sourceContent: options?.sourceContent,
    contextBefore: options?.contextBefore,
    contextAfter: options?.contextAfter,
    instruction: options?.instruction,
  }, options?.signal),
  chat: (storyId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    fetchEventStream(`/stories/${storyId}/librarian/chat`, { messages }),
  getChatHistory: (storyId: string) =>
    apiFetch<ChatHistory>(`/stories/${storyId}/librarian/chat`),
  clearChatHistory: (storyId: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/librarian/chat`, { method: 'DELETE' }),
  getAnalysisStream: (storyId: string) =>
    fetchGetEventStream(`/stories/${storyId}/librarian/analysis-stream`),
  // Conversations
  listConversations: (storyId: string) =>
    apiFetch<ConversationMeta[]>(`/stories/${storyId}/librarian/conversations`),
  createConversation: (storyId: string, title?: string) =>
    apiFetch<ConversationMeta>(`/stories/${storyId}/librarian/conversations`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (storyId: string, conversationId: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/librarian/conversations/${conversationId}`, {
      method: 'DELETE',
    }),
  getConversationHistory: (storyId: string, conversationId: string) =>
    apiFetch<ChatHistory>(`/stories/${storyId}/librarian/conversations/${conversationId}/chat`),
  conversationChat: (storyId: string, conversationId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    fetchEventStream(`/stories/${storyId}/librarian/conversations/${conversationId}/chat`, { messages }),
}
