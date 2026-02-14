import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir } from '../setup'
import {
  createStory,
  createFragment,
  getFragment,
} from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'
import { createFragmentTools } from '@/server/llm/tools'

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: { outputFormat: 'markdown', enabledPlugins: [] },
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
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    ...overrides,
  }
}

describe('LLM tools', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-test'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await createStory(dataDir, makeStory())
  })

  afterEach(async () => {
    await cleanup()
  })

  it('creates all expected tools', () => {
    const tools = createFragmentTools(dataDir, storyId)
    expect(tools).toHaveProperty('fragmentGet')
    expect(tools).toHaveProperty('fragmentSet')
    expect(tools).toHaveProperty('fragmentEdit')
    expect(tools).toHaveProperty('fragmentDelete')
    expect(tools).toHaveProperty('fragmentList')
    expect(tools).toHaveProperty('fragmentTypesList')
  })

  describe('fragmentGet', () => {
    it('retrieves a fragment by ID', async () => {
      const frag = makeFragment({
        id: 'pr-0001',
        content: 'Hello world',
      })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.fragmentGet.execute(
        { fragmentId: 'pr-0001' },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.content).toBe('Hello world')
      expect(result.name).toBe('Test')
    })

    it('returns error for non-existent fragment', async () => {
      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.fragmentGet.execute(
        { fragmentId: 'pr-9999' },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.error).toBeDefined()
    })
  })

  describe('fragmentSet', () => {
    it('overwrites a fragment content', async () => {
      const frag = makeFragment({
        id: 'pr-0001',
        content: 'Old content',
        description: 'Old desc',
      })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.fragmentSet.execute(
        {
          fragmentId: 'pr-0001',
          newContent: 'New content',
          newDescription: 'New desc',
        },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.ok).toBe(true)

      const updated = await getFragment(dataDir, storyId, 'pr-0001')
      expect(updated!.content).toBe('New content')
      expect(updated!.description).toBe('New desc')
    })
  })

  describe('fragmentEdit', () => {
    it('replaces text within a fragment', async () => {
      const frag = makeFragment({
        id: 'pr-0001',
        content: 'The cat sat on the mat.',
      })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.fragmentEdit.execute(
        {
          fragmentId: 'pr-0001',
          oldText: 'cat',
          newText: 'dog',
        },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.ok).toBe(true)

      const updated = await getFragment(dataDir, storyId, 'pr-0001')
      expect(updated!.content).toBe('The dog sat on the mat.')
    })

    it('returns error when oldText not found', async () => {
      const frag = makeFragment({
        id: 'pr-0001',
        content: 'The cat sat.',
      })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.fragmentEdit.execute(
        {
          fragmentId: 'pr-0001',
          oldText: 'elephant',
          newText: 'dog',
        },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.error).toBeDefined()
    })
  })

  describe('fragmentDelete', () => {
    it('deletes a fragment from storage', async () => {
      const frag = makeFragment({ id: 'pr-0001' })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.fragmentDelete.execute(
        { fragmentId: 'pr-0001' },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.ok).toBe(true)

      const deleted = await getFragment(dataDir, storyId, 'pr-0001')
      expect(deleted).toBeNull()
    })
  })

  describe('fragmentList', () => {
    it('lists fragments by type with shortlist fields', async () => {
      const prose1 = makeFragment({
        id: 'pr-0001',
        type: 'prose',
        name: 'Chapter 1',
        description: 'Opening chapter',
      })
      const prose2 = makeFragment({
        id: 'pr-0002',
        type: 'prose',
        name: 'Chapter 2',
        description: 'Second chapter',
      })
      const char = makeFragment({
        id: 'ch-0001',
        type: 'character',
        name: 'Hero',
        description: 'The protagonist',
      })
      await createFragment(dataDir, storyId, prose1)
      await createFragment(dataDir, storyId, prose2)
      await createFragment(dataDir, storyId, char)

      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.fragmentList.execute(
        { type: 'prose' },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.fragments).toHaveLength(2)
      expect(result.fragments[0]).toHaveProperty('id')
      expect(result.fragments[0]).toHaveProperty('name')
      expect(result.fragments[0]).toHaveProperty('description')
      // Should NOT include full content in shortlist
      expect(result.fragments[0]).not.toHaveProperty('content')
    })
  })

  describe('fragmentTypesList', () => {
    it('returns all registered fragment types', async () => {
      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.fragmentTypesList.execute(
        {},
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.types).toBeInstanceOf(Array)
      expect(result.types.length).toBeGreaterThanOrEqual(4)

      const typeNames = result.types.map((t: { type: string }) => t.type)
      expect(typeNames).toContain('prose')
      expect(typeNames).toContain('character')
      expect(typeNames).toContain('guideline')
      expect(typeNames).toContain('knowledge')
    })
  })
})
