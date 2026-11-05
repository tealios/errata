import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import {
  createStory,
  createFragment,
} from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

vi.mock('@/server/librarian/scheduler', () => ({
  triggerLibrarian: vi.fn().mockResolvedValue(undefined),
}))

import { triggerLibrarian } from '@/server/librarian/scheduler'
import { createFragmentTools } from '@/server/llm/tools'
import { saveAnalysis, getAnalysisIndex } from '@/server/librarian/storage'
import {
  getAgentBlockConfig,
  saveAgentBlockConfig,
} from '@/server/agents/agent-block-storage'

const mockedTriggerLibrarian = vi.mocked(triggerLibrarian)

const storyId = 'story-test'

function makeStory(settingsOverrides?: Partial<StoryMeta['settings']>): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: storyId,
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(settingsOverrides),
  }
}

function makeFragment(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'pr-0001',
    type: 'prose',
    name: 'Test',
    description: 'A test fragment',
    content: 'Test content',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user' as const,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    ...overrides,
  }
}

async function seedAnalysis(dataDir: string, fragmentId: string) {
  await saveAnalysis(dataDir, storyId, {
    id: 'la-seed',
    createdAt: new Date().toISOString(),
    fragmentId,
    summaryUpdate: 'seed summary',
    mentionedCharacters: [],
    contradictions: [],
    fragmentSuggestions: [],
    timelineEvents: [],
  })
}

describe('LLM write tools librarian re-analysis', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    mockedTriggerLibrarian.mockClear()
  })

  afterEach(async () => {
    await cleanup()
  })

  it('editProse schedules re-analysis and clears the analysis index entry', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001', content: 'The ipsum sat.' }))
    await seedAnalysis(dataDir, 'pr-0001')

    const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
    const result = await tools.editProse.execute!(
      { oldText: 'ipsum', newText: 'cat' },
      { toolCallId: 'tc-1', messages: [] },
    )
    expect(result.ok).toBe(true)

    expect(mockedTriggerLibrarian).toHaveBeenCalledTimes(1)
    expect(mockedTriggerLibrarian).toHaveBeenCalledWith(
      dataDir,
      storyId,
      expect.objectContaining({ id: 'pr-0001', type: 'prose', content: 'The cat sat.' }),
    )

    const index = await getAnalysisIndex(dataDir, storyId)
    expect(index?.latestByFragmentId['pr-0001']).toBeUndefined()
  })

  it('updateFragment on prose schedules re-analysis', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001', content: 'Old content' }))

    const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
    const result = await tools.updateFragment.execute!(
      { fragmentId: 'pr-0001', newContent: 'New content', newDescription: 'New desc' },
      { toolCallId: 'tc-1', messages: [] },
    )
    expect(result.ok).toBe(true)

    expect(mockedTriggerLibrarian).toHaveBeenCalledTimes(1)
    expect(mockedTriggerLibrarian).toHaveBeenCalledWith(
      dataDir,
      storyId,
      expect.objectContaining({ id: 'pr-0001', type: 'prose' }),
    )
  })

  it('editFragment on prose schedules re-analysis and clears the index entry', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001', content: 'The cat sat.' }))
    await seedAnalysis(dataDir, 'pr-0001')

    const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
    const result = await tools.editFragment.execute!(
      { fragmentId: 'pr-0001', oldText: 'cat', newText: 'dog' },
      { toolCallId: 'tc-1', messages: [] },
    )
    expect(result.ok).toBe(true)

    expect(mockedTriggerLibrarian).toHaveBeenCalledTimes(1)
    const index = await getAnalysisIndex(dataDir, storyId)
    expect(index?.latestByFragmentId['pr-0001']).toBeUndefined()
  })

  it('does not schedule re-analysis when updateFragment leaves prose unchanged', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({
      id: 'pr-0001',
      content: 'Same content',
      description: 'Same desc',
    }))

    const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
    const result = await tools.updateFragment.execute!(
      { fragmentId: 'pr-0001', newContent: 'Same content', newDescription: 'Same desc' },
      { toolCallId: 'tc-1', messages: [] },
    )
    expect(result.ok).toBe(true)

    expect(mockedTriggerLibrarian).not.toHaveBeenCalled()
  })

  it('does not schedule re-analysis for non-prose edits', async () => {
    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({
      id: 'ch-0001',
      type: 'character',
      content: 'Old bio',
    }))

    const tools = createFragmentTools(dataDir, storyId, { readOnly: false })

    const updateResult = await tools.updateFragment.execute!(
      { fragmentId: 'ch-0001', newContent: 'New bio', newDescription: 'Hero' },
      { toolCallId: 'tc-1', messages: [] },
    )
    expect(updateResult.ok).toBe(true)

    const editResult = await tools.editFragment.execute!(
      { fragmentId: 'ch-0001', oldText: 'New', newText: 'Updated' },
      { toolCallId: 'tc-2', messages: [] },
    )
    expect(editResult.ok).toBe(true)

    expect(mockedTriggerLibrarian).not.toHaveBeenCalled()
  })

  it('story setting disableLibrarianAutoAnalysis suppresses scheduling but still clears the index', async () => {
    await createStory(dataDir, makeStory({ disableLibrarianAutoAnalysis: true }))
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001', content: 'The ipsum sat.' }))
    await seedAnalysis(dataDir, 'pr-0001')

    const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
    const result = await tools.editProse.execute!(
      { oldText: 'ipsum', newText: 'cat' },
      { toolCallId: 'tc-1', messages: [] },
    )
    expect(result.ok).toBe(true)

    expect(mockedTriggerLibrarian).not.toHaveBeenCalled()
    const index = await getAnalysisIndex(dataDir, storyId)
    expect(index?.latestByFragmentId['pr-0001']).toBeUndefined()
  })

  it('agent config disableAutoAnalysis suppresses scheduling', async () => {
    await createStory(dataDir, makeStory())
    const config = await getAgentBlockConfig(dataDir, storyId, 'librarian.analyze')
    await saveAgentBlockConfig(dataDir, storyId, 'librarian.analyze', {
      ...config,
      disableAutoAnalysis: true,
    })
    await createFragment(dataDir, storyId, makeFragment({ id: 'pr-0001', content: 'Old content' }))

    const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
    const result = await tools.updateFragment.execute!(
      { fragmentId: 'pr-0001', newContent: 'New content', newDescription: 'New desc' },
      { toolCallId: 'tc-1', messages: [] },
    )
    expect(result.ok).toBe(true)

    expect(mockedTriggerLibrarian).not.toHaveBeenCalled()
  })
})
