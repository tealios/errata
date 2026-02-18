import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getContentRoot } from '../fragments/branches'

// --- Types ---

export interface LibrarianAnalysis {
  id: string
  createdAt: string
  fragmentId: string
  summaryUpdate: string
  mentionedCharacters: string[]
  mentions?: Array<{ characterId: string; text: string }>
  contradictions: Array<{
    description: string
    fragmentIds: string[]
  }>
  knowledgeSuggestions: Array<{
    type: 'character' | 'knowledge'
    targetFragmentId?: string
    name: string
    description: string
    content: string
    sourceFragmentId?: string
    accepted?: boolean
    autoApplied?: boolean
    createdFragmentId?: string
  }>
  timelineEvents: Array<{
    event: string
    position: 'before' | 'during' | 'after'
  }>
  trace?: Array<{
    type: string
    [key: string]: unknown
  }>
}

export interface LibrarianAnalysisSummary {
  id: string
  createdAt: string
  fragmentId: string
  contradictionCount: number
  suggestionCount: number
  pendingSuggestionCount: number
  timelineEventCount: number
  hasTrace?: boolean
}

export interface LibrarianState {
  lastAnalyzedFragmentId: string | null
  /** Fragment ID up to which summaries have been applied to the story summary */
  summarizedUpTo: string | null
  recentMentions: Record<string, string[]>
  timeline: Array<{ event: string; fragmentId: string }>
}

// --- Path helpers ---

async function librarianDir(dataDir: string, storyId: string): Promise<string> {
  const root = await getContentRoot(dataDir, storyId)
  return join(root, 'librarian')
}

async function analysesDir(dataDir: string, storyId: string): Promise<string> {
  const dir = await librarianDir(dataDir, storyId)
  return join(dir, 'analyses')
}

async function analysisPath(dataDir: string, storyId: string, analysisId: string): Promise<string> {
  const dir = await analysesDir(dataDir, storyId)
  return join(dir, `${analysisId}.json`)
}

async function statePath(dataDir: string, storyId: string): Promise<string> {
  const dir = await librarianDir(dataDir, storyId)
  return join(dir, 'state.json')
}

// --- Storage functions ---

export async function saveAnalysis(
  dataDir: string,
  storyId: string,
  analysis: LibrarianAnalysis,
): Promise<void> {
  const dir = await analysesDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  await writeFile(
    await analysisPath(dataDir, storyId, analysis.id),
    JSON.stringify(analysis, null, 2),
    'utf-8',
  )
}

export async function getAnalysis(
  dataDir: string,
  storyId: string,
  analysisId: string,
): Promise<LibrarianAnalysis | null> {
  const path = await analysisPath(dataDir, storyId, analysisId)
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as LibrarianAnalysis
}

export async function listAnalyses(
  dataDir: string,
  storyId: string,
): Promise<LibrarianAnalysisSummary[]> {
  const dir = await analysesDir(dataDir, storyId)
  if (!existsSync(dir)) return []

  const entries = await readdir(dir)
  const summaries: LibrarianAnalysisSummary[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const raw = await readFile(join(dir, entry), 'utf-8')
    const analysis = JSON.parse(raw) as LibrarianAnalysis
    summaries.push({
      id: analysis.id,
      createdAt: analysis.createdAt,
      fragmentId: analysis.fragmentId,
      contradictionCount: analysis.contradictions.length,
      suggestionCount: analysis.knowledgeSuggestions.length,
      pendingSuggestionCount: analysis.knowledgeSuggestions.filter((s) => !s.accepted).length,
      timelineEventCount: analysis.timelineEvents.length,
      hasTrace: !!analysis.trace?.length,
    })
  }

  // Sort newest first
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return summaries
}

export async function getState(
  dataDir: string,
  storyId: string,
): Promise<LibrarianState> {
  const path = await statePath(dataDir, storyId)
  if (!existsSync(path)) {
    return {
      lastAnalyzedFragmentId: null,
      summarizedUpTo: null,
      recentMentions: {},
      timeline: [],
    }
  }
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as LibrarianState
}

export async function saveState(
  dataDir: string,
  storyId: string,
  state: LibrarianState,
): Promise<void> {
  const dir = await librarianDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  await writeFile(await statePath(dataDir, storyId), JSON.stringify(state, null, 2), 'utf-8')
}

// --- Chat history ---

export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
}

export interface ChatHistory {
  messages: ChatHistoryMessage[]
  updatedAt: string
}

async function chatHistoryPath(dataDir: string, storyId: string): Promise<string> {
  const dir = await librarianDir(dataDir, storyId)
  return join(dir, 'chat-history.json')
}

export async function getChatHistory(
  dataDir: string,
  storyId: string,
): Promise<ChatHistory> {
  const path = await chatHistoryPath(dataDir, storyId)
  if (!existsSync(path)) {
    return { messages: [], updatedAt: new Date().toISOString() }
  }
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as ChatHistory
}

export async function saveChatHistory(
  dataDir: string,
  storyId: string,
  messages: ChatHistoryMessage[],
): Promise<void> {
  const dir = await librarianDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  const history: ChatHistory = {
    messages,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(await chatHistoryPath(dataDir, storyId), JSON.stringify(history, null, 2), 'utf-8')
}

export async function clearChatHistory(
  dataDir: string,
  storyId: string,
): Promise<void> {
  const path = await chatHistoryPath(dataDir, storyId)
  if (existsSync(path)) {
    const { unlink } = await import('node:fs/promises')
    await unlink(path)
  }
}
