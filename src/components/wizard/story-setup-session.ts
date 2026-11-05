import { z } from 'zod/v4'
import type {
  StorySetupChecklistItem,
  StorySetupDraftFragment,
  StorySetupMessage,
} from '@/lib/api'

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const StorySetupSessionSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    toolCalls: z.array(z.object({
      toolName: z.string(),
      args: z.record(z.string(), z.unknown()).optional(),
      result: z.unknown().optional(),
      error: z.string().optional(),
    })).optional(),
  })),
  checklist: z.array(z.object({
    key: z.enum(['starting-point', 'premise', 'characters', 'goal', 'setting', 'voice', 'opening']),
    status: z.enum(['missing', 'partial', 'covered']),
    note: z.string(),
  })),
  draftFragments: z.array(z.object({
    id: z.string().optional(),
    key: z.string(),
    type: z.enum(['guideline', 'knowledge', 'character', 'prose']),
    name: z.string(),
    description: z.string(),
    content: z.string(),
  })),
})

export interface StorySetupSession {
  messages: StorySetupMessage[]
  checklist: StorySetupChecklistItem[]
  draftFragments: StorySetupDraftFragment[]
}

function sessionKey(storyId: string) {
  return `errata:story-setup:${storyId}`
}

export function readStorySetupSession(storage: StorageLike, storyId: string): StorySetupSession | null {
  try {
    const raw = storage.getItem(sessionKey(storyId))
    if (!raw) return null
    const parsed = StorySetupSessionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeStorySetupSession(storage: StorageLike, storyId: string, session: StorySetupSession): void {
  try {
    storage.setItem(sessionKey(storyId), JSON.stringify(session))
  } catch {
    // Setup remains usable if browser storage is unavailable or full.
  }
}
