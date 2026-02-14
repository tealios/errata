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
    settings: { outputFormat: 'markdown', enabledPlugins: [], summarizationThreshold: 4, maxSteps: 10, providerId: null, modelId: null, contextOrderMode: 'simple' as const, fragmentOrder: [] },
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

  describe('read-only tools (default)', () => {
    it('creates type-specific read tools for all built-in types', () => {
      const tools = createFragmentTools(dataDir, storyId)
      // Per-type get tools
      expect(tools).toHaveProperty('getProse')
      expect(tools).toHaveProperty('getCharacter')
      expect(tools).toHaveProperty('getGuideline')
      expect(tools).toHaveProperty('getKnowledge')
      expect(tools).toHaveProperty('getImage')
      expect(tools).toHaveProperty('getIcon')
      // Per-type list tools
      expect(tools).toHaveProperty('listProse')
      expect(tools).toHaveProperty('listCharacters')
      expect(tools).toHaveProperty('listGuidelines')
      expect(tools).toHaveProperty('listKnowledge')
      expect(tools).toHaveProperty('listImages')
      expect(tools).toHaveProperty('listIcons')
      // Always present
      expect(tools).toHaveProperty('listFragmentTypes')
    })

    it('does not include write tools by default', () => {
      const tools = createFragmentTools(dataDir, storyId)
      expect(tools).not.toHaveProperty('updateFragment')
      expect(tools).not.toHaveProperty('editFragment')
      expect(tools).not.toHaveProperty('deleteFragment')
    })

    it('does not include write tools when readOnly: true', () => {
      const tools = createFragmentTools(dataDir, storyId, { readOnly: true })
      expect(tools).not.toHaveProperty('updateFragment')
      expect(tools).not.toHaveProperty('editFragment')
      expect(tools).not.toHaveProperty('deleteFragment')
    })
  })

  describe('read-write tools', () => {
    it('includes both read and write tools when readOnly: false', () => {
      const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
      // Read tools still present
      expect(tools).toHaveProperty('getCharacter')
      expect(tools).toHaveProperty('listCharacters')
      expect(tools).toHaveProperty('listFragmentTypes')
      // Write tools present
      expect(tools).toHaveProperty('updateFragment')
      expect(tools).toHaveProperty('editFragment')
      expect(tools).toHaveProperty('deleteFragment')
    })
  })

  describe('getCharacter / getProse (type-specific get)', () => {
    it('retrieves a character fragment by ID', async () => {
      const frag = makeFragment({
        id: 'ch-0001',
        type: 'character',
        name: 'Hero',
        content: 'A brave warrior',
      })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.getCharacter.execute(
        { id: 'ch-0001' },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.content).toBe('A brave warrior')
      expect(result.name).toBe('Hero')
    })

    it('retrieves a prose fragment by ID', async () => {
      const frag = makeFragment({
        id: 'pr-0001',
        content: 'Hello world',
      })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.getProse.execute(
        { id: 'pr-0001' },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.content).toBe('Hello world')
      expect(result.name).toBe('Test')
    })

    it('returns error for non-existent fragment', async () => {
      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.getCharacter.execute(
        { id: 'ch-9999' },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.error).toBeDefined()
    })
  })

  describe('listCharacters / listProse (type-specific list)', () => {
    it('lists only fragments of the matching type', async () => {
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

      const proseResult = await tools.listProse.execute(
        {},
        { toolCallId: 'tc-1', messages: [] },
      )
      expect(proseResult.fragments).toHaveLength(2)
      expect(proseResult.fragments[0]).toHaveProperty('id')
      expect(proseResult.fragments[0]).toHaveProperty('name')
      expect(proseResult.fragments[0]).toHaveProperty('description')
      expect(proseResult.fragments[0]).not.toHaveProperty('content')

      const charResult = await tools.listCharacters.execute(
        {},
        { toolCallId: 'tc-1', messages: [] },
      )
      expect(charResult.fragments).toHaveLength(1)
      expect(charResult.fragments[0].name).toBe('Hero')
    })
  })

  describe('updateFragment (write)', () => {
    it('overwrites a fragment content', async () => {
      const frag = makeFragment({
        id: 'pr-0001',
        content: 'Old content',
        description: 'Old desc',
      })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
      const result = await tools.updateFragment.execute(
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

  describe('editFragment (write)', () => {
    it('replaces text within a fragment', async () => {
      const frag = makeFragment({
        id: 'pr-0001',
        content: 'The cat sat on the mat.',
      })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
      const result = await tools.editFragment.execute(
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

      const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
      const result = await tools.editFragment.execute(
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

  describe('deleteFragment (write)', () => {
    it('deletes a fragment from storage', async () => {
      const frag = makeFragment({ id: 'pr-0001' })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
      const result = await tools.deleteFragment.execute(
        { fragmentId: 'pr-0001' },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.ok).toBe(true)

      const deleted = await getFragment(dataDir, storyId, 'pr-0001')
      expect(deleted).toBeNull()
    })
  })

  describe('listFragmentTypes', () => {
    it('returns all registered fragment types', async () => {
      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.listFragmentTypes.execute(
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
      expect(typeNames).toContain('image')
      expect(typeNames).toContain('icon')
    })
  })
})
