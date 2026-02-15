import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir } from '../setup'
import { createApp } from '@/server/api'
import { createStory, getFragment } from '@/server/fragments/storage'
import {
  saveAnalysis,
  saveState,
  type LibrarianAnalysis,
  type LibrarianState,
} from '@/server/librarian/storage'

// Mock the AI SDK to prevent real LLM calls
vi.mock('ai', () => ({
  stepCountIs: vi.fn((n: number) => n),
  streamText: vi.fn(() => {
    const text = 'Generated text'
    // Create a proper ReadableStream for textStream that supports tee()
    const textStream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(text)
        controller.close()
      },
    })
    return {
      textStream,
      text: Promise.resolve(text),
      usage: Promise.resolve({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }),
      finishReason: Promise.resolve('stop' as const),
      steps: Promise.resolve([]),
      toTextStreamResponse: () =>
        new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
    }
  }),
  tool: vi.fn((def: unknown) => def),
  generateText: vi.fn(),
  generateObject: vi.fn(),
}))

function makeAnalysis(overrides: Partial<LibrarianAnalysis> = {}): LibrarianAnalysis {
  return {
    id: `analysis-${Date.now()}`,
    createdAt: new Date().toISOString(),
    fragmentId: 'pr-0001',
    summaryUpdate: 'Something happened.',
    mentionedCharacters: ['ch-0001'],
    contradictions: [],
    knowledgeSuggestions: [],
    timelineEvents: [],
    ...overrides,
  }
}

describe('librarian API routes', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>
  const storyId = 'story-lib-api'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    app = createApp(dataDir)

    await createStory(dataDir, {
      id: storyId,
      name: 'Librarian API Test',
      description: 'Testing librarian routes',
      summary: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      settings: {
        outputFormat: 'markdown',
        enabledPlugins: [],
        summarizationThreshold: 4,
        maxSteps: 10,
        providerId: null,
        modelId: null,
        contextOrderMode: 'simple' as const,
        fragmentOrder: [],
      },
    })
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('GET /stories/:storyId/librarian/status', () => {
    it('returns default state for new story', async () => {
      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${storyId}/librarian/status`),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({
        lastAnalyzedFragmentId: null,
        recentMentions: {},
        timeline: [],
      })
    })

    it('returns saved state', async () => {
      const state: LibrarianState = {
        lastAnalyzedFragmentId: 'pr-0001',
        recentMentions: { 'ch-0001': ['pr-0001'] },
        timeline: [{ event: 'Battle', fragmentId: 'pr-0001' }],
      }
      await saveState(dataDir, storyId, state)

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${storyId}/librarian/status`),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.lastAnalyzedFragmentId).toBe('pr-0001')
      expect(data.recentMentions['ch-0001']).toEqual(['pr-0001'])
      expect(data.timeline).toHaveLength(1)
    })
  })

  describe('GET /stories/:storyId/librarian/analyses', () => {
    it('returns empty list when no analyses exist', async () => {
      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${storyId}/librarian/analyses`),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual([])
    })

    it('returns analyses sorted newest first', async () => {
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-old',
        createdAt: '2025-01-01T00:00:00.000Z',
      }))
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-new',
        createdAt: '2025-01-02T00:00:00.000Z',
      }))

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${storyId}/librarian/analyses`),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveLength(2)
      expect(data[0].id).toBe('analysis-new')
      expect(data[1].id).toBe('analysis-old')
      // Should be summaries
      expect(data[0]).toHaveProperty('contradictionCount')
      expect(data[0]).not.toHaveProperty('summaryUpdate')
    })
  })

  describe('GET /stories/:storyId/librarian/analyses/:analysisId', () => {
    it('returns full analysis by ID', async () => {
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-detail',
        summaryUpdate: 'The hero entered the cave.',
        mentionedCharacters: ['ch-0001'],
        contradictions: [
          { description: 'Eye color mismatch', fragmentIds: ['pr-0001'] },
        ],
      }))

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${storyId}/librarian/analyses/analysis-detail`),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.id).toBe('analysis-detail')
      expect(data.summaryUpdate).toBe('The hero entered the cave.')
      expect(data.mentionedCharacters).toEqual(['ch-0001'])
      expect(data.contradictions).toHaveLength(1)
    })

    it('returns 404 for non-existent analysis', async () => {
      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${storyId}/librarian/analyses/nonexistent`),
      )
      expect(res.status).toBe(404)
    })
  })

  describe('POST /stories/:storyId/librarian/analyses/:analysisId/suggestions/:index/accept', () => {
    it('marks a suggestion as accepted and creates a fragment', async () => {
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-accept',
        knowledgeSuggestions: [
          { type: 'knowledge', name: 'Dragon Lore', description: 'Dragons breathe fire', content: 'Full details about dragons.' },
          { type: 'character', name: 'Hero', description: 'Main character', content: 'Hero backstory.' },
        ],
      }))

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${storyId}/librarian/analyses/analysis-accept/suggestions/0/accept`, {
          method: 'POST',
        }),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.analysis.knowledgeSuggestions[0].accepted).toBe(true)
      expect(data.analysis.knowledgeSuggestions[1].accepted).toBeUndefined()
      expect(data.createdFragmentId).toBeTruthy()

      const created = await getFragment(dataDir, storyId, data.createdFragmentId)
      expect(created).toBeTruthy()
      expect(created?.name).toBe('Dragon Lore')
      expect(created?.type).toBe('knowledge')
    })

    it('returns 404 for non-existent analysis', async () => {
      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${storyId}/librarian/analyses/nonexistent/suggestions/0/accept`, {
          method: 'POST',
        }),
      )
      expect(res.status).toBe(404)
    })

    it('returns 422 for invalid suggestion index', async () => {
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-badidx',
        knowledgeSuggestions: [
          { type: 'knowledge', name: 'Test', description: 'Test', content: 'Test' },
        ],
      }))

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${storyId}/librarian/analyses/analysis-badidx/suggestions/5/accept`, {
          method: 'POST',
        }),
      )
      expect(res.status).toBe(422)
      const data = await res.json()
      expect(data.error).toContain('Invalid suggestion index')
    })

    it('returns 422 for negative index', async () => {
      await saveAnalysis(dataDir, storyId, makeAnalysis({
        id: 'analysis-negidx',
        knowledgeSuggestions: [
          { type: 'knowledge', name: 'Test', description: 'Test', content: 'Test' },
        ],
      }))

      const res = await app.fetch(
        new Request(`http://localhost/api/stories/${storyId}/librarian/analyses/analysis-negidx/suggestions/-1/accept`, {
          method: 'POST',
        }),
      )
      expect(res.status).toBe(422)
    })
  })
})
