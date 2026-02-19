import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getContentRoot } from '../fragments/branches'

// --- Types ---

export type PersonaMode =
  | { type: 'character'; characterId: string }
  | { type: 'stranger' }
  | { type: 'custom'; prompt: string }

export interface CharacterChatMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  createdAt: string
}

export interface CharacterChatConversation {
  id: string
  characterId: string
  persona: PersonaMode
  storyPointFragmentId: string | null
  title: string
  messages: CharacterChatMessage[]
  createdAt: string
  updatedAt: string
}

export interface CharacterChatConversationSummary {
  id: string
  characterId: string
  persona: PersonaMode
  storyPointFragmentId: string | null
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

// --- ID generation ---

export function generateConversationId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `cc-${ts}-${rand}`
}

// --- Path helpers ---

async function characterChatDir(dataDir: string, storyId: string): Promise<string> {
  const root = await getContentRoot(dataDir, storyId)
  return join(root, 'character-chat')
}

async function conversationsDir(dataDir: string, storyId: string): Promise<string> {
  const dir = await characterChatDir(dataDir, storyId)
  return join(dir, 'conversations')
}

async function conversationPath(dataDir: string, storyId: string, conversationId: string): Promise<string> {
  const dir = await conversationsDir(dataDir, storyId)
  return join(dir, `${conversationId}.json`)
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmpPath = `${path}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
  await rename(tmpPath, path)
}

// --- CRUD ---

export async function saveConversation(
  dataDir: string,
  storyId: string,
  conversation: CharacterChatConversation,
): Promise<void> {
  const dir = await conversationsDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  await writeJsonAtomic(
    await conversationPath(dataDir, storyId, conversation.id),
    conversation,
  )
}

export async function getConversation(
  dataDir: string,
  storyId: string,
  conversationId: string,
): Promise<CharacterChatConversation | null> {
  const path = await conversationPath(dataDir, storyId, conversationId)
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as CharacterChatConversation
}

export async function listConversations(
  dataDir: string,
  storyId: string,
  characterId?: string,
): Promise<CharacterChatConversationSummary[]> {
  const dir = await conversationsDir(dataDir, storyId)
  if (!existsSync(dir)) return []

  const entries = await readdir(dir)
  const summaries: CharacterChatConversationSummary[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const raw = await readFile(join(dir, entry), 'utf-8')
    const conv = JSON.parse(raw) as CharacterChatConversation

    if (characterId && conv.characterId !== characterId) continue

    summaries.push({
      id: conv.id,
      characterId: conv.characterId,
      persona: conv.persona,
      storyPointFragmentId: conv.storyPointFragmentId,
      title: conv.title,
      messageCount: conv.messages.length,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    })
  }

  // Sort newest first
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return summaries
}

export async function deleteConversation(
  dataDir: string,
  storyId: string,
  conversationId: string,
): Promise<boolean> {
  const path = await conversationPath(dataDir, storyId, conversationId)
  if (!existsSync(path)) return false
  const { unlink } = await import('node:fs/promises')
  await unlink(path)
  return true
}
