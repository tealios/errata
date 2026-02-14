import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

// --- Types ---

export interface LibrarianAnalysis {
  id: string
  createdAt: string
  fragmentId: string
  summaryUpdate: string
  mentionedCharacters: string[]
  contradictions: Array<{
    description: string
    fragmentIds: string[]
  }>
  knowledgeSuggestions: Array<{
    type: 'character' | 'knowledge'
    name: string
    description: string
    content: string
  }>
  timelineEvents: Array<{
    event: string
    position: 'before' | 'during' | 'after'
  }>
}

export interface LibrarianAnalysisSummary {
  id: string
  createdAt: string
  fragmentId: string
  contradictionCount: number
  suggestionCount: number
  timelineEventCount: number
}

export interface LibrarianState {
  lastAnalyzedFragmentId: string | null
  recentMentions: Record<string, string[]>
  timeline: Array<{ event: string; fragmentId: string }>
}

// --- Path helpers ---

function librarianDir(dataDir: string, storyId: string): string {
  return join(dataDir, 'stories', storyId, 'librarian')
}

function analysesDir(dataDir: string, storyId: string): string {
  return join(librarianDir(dataDir, storyId), 'analyses')
}

function analysisPath(dataDir: string, storyId: string, analysisId: string): string {
  return join(analysesDir(dataDir, storyId), `${analysisId}.json`)
}

function statePath(dataDir: string, storyId: string): string {
  return join(librarianDir(dataDir, storyId), 'state.json')
}

// --- Storage functions ---

export async function saveAnalysis(
  dataDir: string,
  storyId: string,
  analysis: LibrarianAnalysis,
): Promise<void> {
  const dir = analysesDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  await writeFile(
    analysisPath(dataDir, storyId, analysis.id),
    JSON.stringify(analysis, null, 2),
    'utf-8',
  )
}

export async function getAnalysis(
  dataDir: string,
  storyId: string,
  analysisId: string,
): Promise<LibrarianAnalysis | null> {
  const path = analysisPath(dataDir, storyId, analysisId)
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as LibrarianAnalysis
}

export async function listAnalyses(
  dataDir: string,
  storyId: string,
): Promise<LibrarianAnalysisSummary[]> {
  const dir = analysesDir(dataDir, storyId)
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
      timelineEventCount: analysis.timelineEvents.length,
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
  const path = statePath(dataDir, storyId)
  if (!existsSync(path)) {
    return {
      lastAnalyzedFragmentId: null,
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
  const dir = librarianDir(dataDir, storyId)
  await mkdir(dir, { recursive: true })
  await writeFile(statePath(dataDir, storyId), JSON.stringify(state, null, 2), 'utf-8')
}
