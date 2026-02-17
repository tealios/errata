import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir, seedTestProvider } from '../setup'
import {
  createStory,
  getStory,
  createFragment,
  getFragment,
} from '@/server/fragments/storage'
import { getState, getAnalysis, listAnalyses } from '@/server/librarian/storage'
import { initProseChain, addProseSection } from '@/server/fragments/prose-chain'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

const { mockAgentGenerate } = vi.hoisted(() => ({
  mockAgentGenerate: vi.fn(),
}))

// Mock the AI SDK ToolLoopAgent
vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    ToolLoopAgent: class {
      generate(args: unknown) {
        return mockAgentGenerate(args)
      }
    },
  }
})

import { runLibrarian } from '@/server/librarian/agent'

function makeStory(
  overrides: Omit<Partial<StoryMeta>, 'settings'> & { settings?: Partial<StoryMeta['settings']> } = {},
): StoryMeta {
  const now = new Date().toISOString()
  const defaultSettings: StoryMeta['settings'] = {
    outputFormat: 'markdown',
    enabledPlugins: [],
    summarizationThreshold: 0,
    maxSteps: 10,
    providerId: null,
    modelId: null,
    librarianProviderId: null,
    librarianModelId: null,
    autoApplyLibrarianSuggestions: false,
    contextOrderMode: 'simple',
    fragmentOrder: [],
    enabledBuiltinTools: [],
  }

  const baseStory: StoryMeta = {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings,
  }

  return {
    ...baseStory,
    ...overrides,
    settings: { ...defaultSettings, ...(overrides.settings ?? {}) },
  }
}

function makeFragment(
  overrides: Partial<Omit<Fragment, 'placement'>> & { placement?: Fragment['placement'] },
): Fragment {
  const { placement, ...rest } = overrides
  const now = new Date().toISOString()
  const baseFragment: Fragment = {
    id: 'pr-0001',
    type: 'prose',
    name: 'Test Prose',
    description: 'Test prose fragment',
    content: 'The hero walked into the dark forest.',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user' as const,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
  }

  return {
    ...baseFragment,
    ...rest,
    placement: placement ?? 'user',
  }
}

function mockGenerateTextResponse(json: Record<string, unknown>) {
  mockAgentGenerate.mockResolvedValue({
    output: json,
    text: JSON.stringify(json),
    finishReason: 'stop',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    response: { id: 'test', modelId: 'test', timestamp: new Date(), headers: {} },
    request: {},
    warnings: [],
    files: [],
    sources: [],
    steps: [],
    toolCalls: [],
    toolResults: [],
  } as any)
}

// Helper to set up prose chain for tests
async function setupProseChain(dataDir: string, storyId: string, proseIds: string[]) {
  if (proseIds.length === 0) return
  await initProseChain(dataDir, storyId, proseIds[0])
  for (let i = 1; i < proseIds.length; i++) {
    await addProseSection(dataDir, storyId, proseIds[i])
  }
}

describe('librarian agent', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-test'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await seedTestProvider(dataDir)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await cleanup()
  })

  it('appends summary update to story meta', async () => {
    await createStory(dataDir, makeStory({ summary: 'The hero was born in a small village.' }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      content: 'The hero walked into the dark forest.',
    }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockGenerateTextResponse({
      summaryUpdate: 'The hero ventured into the dark forest.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    await runLibrarian(dataDir, storyId, 'pr-0001')

    const story = await getStory(dataDir, storyId)
    expect(story!.summary).toBe(
      'The hero was born in a small village. The hero ventured into the dark forest.',
    )
  })

  it('sets summary when story had no summary', async () => {
    await createStory(dataDir, makeStory({ summary: '' }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockGenerateTextResponse({
      summaryUpdate: 'The story begins.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    await runLibrarian(dataDir, storyId, 'pr-0001')

    const story = await getStory(dataDir, storyId)
    expect(story!.summary).toBe('The story begins.')
  })

  it('detects character mentions', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({
      id: 'ch-0001',
      type: 'character',
      name: 'Alice',
      description: 'The protagonist',
    }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      content: 'Alice drew her sword and faced the dragon.',
    }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockGenerateTextResponse({
      summaryUpdate: 'Alice confronted a dragon.',
      mentionedCharacters: ['ch-0001'],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    const analysis = await runLibrarian(dataDir, storyId, 'pr-0001')
    expect(analysis.mentionedCharacters).toEqual(['ch-0001'])

    const state = await getState(dataDir, storyId)
    expect(state.recentMentions['ch-0001']).toEqual(['pr-0001'])
    expect(state.lastAnalyzedFragmentId).toBe('pr-0001')
  })

  it('accumulates mentions across multiple runs', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({
      id: 'ch-0001',
      type: 'character',
      name: 'Alice',
      description: 'The protagonist',
    }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      content: 'Alice entered the castle.',
    }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0002',
      content: 'Alice found the treasure room.',
    }))
    await setupProseChain(dataDir, storyId, ['pr-0001', 'pr-0002'])

    // First run
    mockGenerateTextResponse({
      summaryUpdate: 'Alice entered the castle.',
      mentionedCharacters: ['ch-0001'],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })
    await runLibrarian(dataDir, storyId, 'pr-0001')

    // Second run
    mockGenerateTextResponse({
      summaryUpdate: 'Alice found the treasure room.',
      mentionedCharacters: ['ch-0001'],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })
    await runLibrarian(dataDir, storyId, 'pr-0002')

    const state = await getState(dataDir, storyId)
    expect(state.recentMentions['ch-0001']).toEqual(['pr-0001', 'pr-0002'])
    expect(state.lastAnalyzedFragmentId).toBe('pr-0002')
  })

  it('flags contradictions', async () => {
    await createStory(dataDir, makeStory({ summary: 'Alice has blue eyes.' }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      content: 'Alice looked at him with her green eyes.',
    }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockGenerateTextResponse({
      summaryUpdate: 'Alice stared at the stranger.',
      mentionedCharacters: [],
      contradictions: [
        {
          description: 'Alice was described as having blue eyes, but new prose says green eyes.',
          fragmentIds: ['pr-0001'],
        },
      ],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    const analysis = await runLibrarian(dataDir, storyId, 'pr-0001')
    expect(analysis.contradictions).toHaveLength(1)
    expect(analysis.contradictions[0].description).toContain('blue eyes')
  })

  it('extracts knowledge suggestions', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      content: 'The ancient city of Valdris stood atop the mountain.',
    }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockGenerateTextResponse({
      summaryUpdate: 'An ancient city called Valdris was revealed.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [
        {
          type: 'knowledge',
          name: 'Valdris',
          description: 'Ancient mountain city',
          content: 'Valdris is an ancient city located atop a mountain.',
        },
      ],
      timelineEvents: [],
    })

    const analysis = await runLibrarian(dataDir, storyId, 'pr-0001')
    expect(analysis.knowledgeSuggestions).toHaveLength(1)
    expect(analysis.knowledgeSuggestions[0].name).toBe('Valdris')
    expect(analysis.knowledgeSuggestions[0].sourceFragmentId).toBe('pr-0001')
  })

  it('auto-applies suggestions and updates existing suggestion fragments', async () => {
    await createStory(dataDir, makeStory({
      settings: {
        autoApplyLibrarianSuggestions: true,
        summarizationThreshold: 0,
      },
    }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      content: 'Valdris was introduced in ancient records.',
    }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0002',
      content: 'Valdris is now protected by stone sentinels.',
    }))
    await setupProseChain(dataDir, storyId, ['pr-0001', 'pr-0002'])

    mockGenerateTextResponse({
      summaryUpdate: 'Valdris appears in old records.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [
        {
          type: 'knowledge',
          name: 'Valdris',
          description: 'Ancient city',
          content: 'Valdris is an ancient mountain city.',
        },
      ],
      timelineEvents: [],
    })

    const first = await runLibrarian(dataDir, storyId, 'pr-0001')
    expect(first.knowledgeSuggestions[0].accepted).toBe(true)
    expect(first.knowledgeSuggestions[0].autoApplied).toBe(true)
    const createdId = first.knowledgeSuggestions[0].createdFragmentId
    expect(createdId).toBeTruthy()

    mockGenerateTextResponse({
      summaryUpdate: 'Valdris defenses were revealed.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [
        {
          type: 'knowledge',
          name: 'Valdris',
          description: 'Ancient defended city',
          content: 'Valdris is an ancient mountain city guarded by stone sentinels.',
        },
      ],
      timelineEvents: [],
    })

    const second = await runLibrarian(dataDir, storyId, 'pr-0002')
    expect(second.knowledgeSuggestions[0].accepted).toBe(true)
    expect(second.knowledgeSuggestions[0].autoApplied).toBe(true)
    expect(second.knowledgeSuggestions[0].createdFragmentId).toBe(createdId)

    const suggestionFragment = await getFragment(dataDir, storyId, createdId!)
    expect(suggestionFragment).toBeTruthy()
    expect(suggestionFragment?.content).toContain('stone sentinels')
    expect(suggestionFragment?.refs).toContain('pr-0001')
    expect(suggestionFragment?.refs).toContain('pr-0002')
  })

  it('auto-applies targeted updates to existing knowledge fragments', async () => {
    await createStory(dataDir, makeStory({
      settings: {
        autoApplyLibrarianSuggestions: true,
        summarizationThreshold: 0,
      },
    }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'kn-0001',
      type: 'knowledge',
      name: 'Valdris',
      description: 'Ancient city',
      content: 'Valdris is an ancient city.',
    }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      content: 'Valdris is defended by sentinels made of stone.',
    }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockGenerateTextResponse({
      summaryUpdate: 'Valdris defenses were revealed.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [
        {
          type: 'knowledge',
          targetFragmentId: 'kn-0001',
          name: 'Valdris',
          description: 'Ancient defended city',
          content: 'Valdris is an ancient city defended by stone sentinels.',
        },
      ],
      timelineEvents: [],
    })

    const analysis = await runLibrarian(dataDir, storyId, 'pr-0001')
    expect(analysis.knowledgeSuggestions[0].accepted).toBe(true)
    expect(analysis.knowledgeSuggestions[0].autoApplied).toBe(true)
    expect(analysis.knowledgeSuggestions[0].createdFragmentId).toBe('kn-0001')

    const updated = await getFragment(dataDir, storyId, 'kn-0001')
    expect(updated).toBeTruthy()
    expect(updated?.content).toContain('stone sentinels')
    expect(updated?.refs).toContain('pr-0001')
  })

  it('tracks timeline events', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      content: 'The hero defeated the dragon. The village celebrated.',
    }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockGenerateTextResponse({
      summaryUpdate: 'The hero defeated the dragon and the village celebrated.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [
        { event: 'Hero defeated the dragon', position: 'during' },
        { event: 'Village celebration', position: 'after' },
      ],
    })

    const analysis = await runLibrarian(dataDir, storyId, 'pr-0001')
    expect(analysis.timelineEvents).toHaveLength(2)

    const state = await getState(dataDir, storyId)
    expect(state.timeline).toHaveLength(2)
    expect(state.timeline[0].event).toBe('Hero defeated the dragon')
    expect(state.timeline[0].fragmentId).toBe('pr-0001')
  })

  it('saves the analysis result', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockGenerateTextResponse({
      summaryUpdate: 'Something happened.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    const analysis = await runLibrarian(dataDir, storyId, 'pr-0001')

    // Verify analysis was persisted
    const loaded = await getAnalysis(dataDir, storyId, analysis.id)
    expect(loaded).toBeDefined()
    expect(loaded!.fragmentId).toBe('pr-0001')
    expect(loaded!.summaryUpdate).toBe('Something happened.')

    // Verify it appears in list
    const summaries = await listAnalyses(dataDir, storyId)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].id).toBe(analysis.id)
  })

  it('handles malformed LLM JSON gracefully', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockAgentGenerate.mockResolvedValue({
      text: 'this is not json',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      response: { id: 'test', modelId: 'test', timestamp: new Date(), headers: {} },
      request: {},
      warnings: [],
      files: [],
      sources: [],
      steps: [],
      toolCalls: [],
      toolResults: [],
    } as any)

    await expect(runLibrarian(dataDir, storyId, 'pr-0001')).rejects.toThrow()
  })

  it('handles JSON wrapped in markdown fences', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    const parsed = {
      summaryUpdate: 'Fenced response.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    }

    mockAgentGenerate.mockResolvedValue({
      text: `\`\`\`json\n${JSON.stringify(parsed)}\n\`\`\``,
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      response: { id: 'test', modelId: 'test', timestamp: new Date(), headers: {} },
      request: {},
      warnings: [],
      files: [],
      sources: [],
      steps: [],
      toolCalls: [],
      toolResults: [],
    } as any)

    const analysis = await runLibrarian(dataDir, storyId, 'pr-0001')
    expect(analysis.summaryUpdate).toBe('Fenced response.')
  })

  it('throws when story does not exist', async () => {
    await expect(runLibrarian(dataDir, 'nonexistent', 'pr-0001')).rejects.toThrow(
      'Story nonexistent not found',
    )
  })

  it('throws when fragment does not exist', async () => {
    await createStory(dataDir, makeStory())

    await expect(runLibrarian(dataDir, storyId, 'pr-missing')).rejects.toThrow(
      'Fragment pr-missing not found',
    )
  })

  it('parses JSON when response includes extra surrounding text', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockAgentGenerate.mockResolvedValue({
      text: `Here is the analysis:\n${JSON.stringify({
        summaryUpdate: 'Fallback worked.',
        mentionedCharacters: [],
        contradictions: [],
        knowledgeSuggestions: [],
        timelineEvents: [],
      })}\nDone.`,
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      response: { id: 'test', modelId: 'test', timestamp: new Date(), headers: {} },
      request: {},
      warnings: [],
      files: [],
      sources: [],
      steps: [],
      toolCalls: [],
      toolResults: [],
    } as any)

    const analysis = await runLibrarian(dataDir, storyId, 'pr-0001')
    expect(analysis.summaryUpdate).toBe('Fallback worked.')
    expect(mockAgentGenerate).toHaveBeenCalledTimes(1)
  })

  it('throws when generated JSON does not match schema', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockAgentGenerate.mockResolvedValue({
      text: JSON.stringify({
        summaryUpdate: 123,
        mentionedCharacters: [],
        contradictions: [],
        knowledgeSuggestions: [],
        timelineEvents: [],
      }),
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      response: { id: 'test', modelId: 'test', timestamp: new Date(), headers: {} },
      request: {},
      warnings: [],
      files: [],
      sources: [],
      steps: [],
      toolCalls: [],
      toolResults: [],
    } as any)

    await expect(runLibrarian(dataDir, storyId, 'pr-0001')).rejects.toThrow()
  })

  it('includes json instruction in prompt', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001' }))
    await setupProseChain(dataDir, storyId, ['pr-0001'])

    mockGenerateTextResponse({
      summaryUpdate: 'Keyword prompt worked.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    const analysis = await runLibrarian(dataDir, storyId, 'pr-0001')
    expect(analysis.summaryUpdate).toBe('Keyword prompt worked.')
    expect(mockAgentGenerate).toHaveBeenCalledTimes(1)
    const call = mockAgentGenerate.mock.calls[0]?.[0] as { prompt?: string } | undefined
    expect(typeof call?.prompt).toBe('string')
  })
})
