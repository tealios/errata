import { apiFetch, fetchEventStream } from './client'
import type { ChatToolCallRecord } from './types'

export interface StorySetupMessage {
  role: 'user' | 'assistant'
  content: string
  /** Tool activity behind an assistant turn, replayed so the model knows what was really saved. */
  toolCalls?: ChatToolCallRecord[]
}

export type StorySetupChecklistKey =
  | 'starting-point'
  | 'premise'
  | 'characters'
  | 'goal'
  | 'setting'
  | 'voice'
  | 'opening'

export interface StorySetupChecklistItem {
  key: StorySetupChecklistKey
  status: 'missing' | 'partial' | 'covered'
  note: string
}

export interface StorySetupDraftFragment {
  id?: string
  key: string
  type: 'guideline' | 'knowledge' | 'character' | 'prose'
  name: string
  description: string
  content: string
}

export interface StorySetupPlan {
  name: string
  description: string
  guideline: string | null
  knowledge: Array<{ name: string; description: string; content: string }>
  characters: Array<{ name: string; description: string; content: string }>
  opening: string | null
}

export interface StorySetupResult {
  plan: StorySetupPlan
  created: Array<{ id: string; type: string; name: string }>
}

export const storySetup = {
  chat: (storyId: string, messages: StorySetupMessage[], signal?: AbortSignal) =>
    fetchEventStream(`/stories/${storyId}/setup/chat`, { messages }, signal),

  complete: (
    storyId: string,
    messages: StorySetupMessage[],
    draftFragments: StorySetupDraftFragment[],
  ) =>
    apiFetch<StorySetupResult>(`/stories/${storyId}/setup/complete`, {
      method: 'POST',
      body: JSON.stringify({ messages, draftFragments }),
    }),
}
