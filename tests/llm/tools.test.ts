import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir } from '../setup'
import {
  createStory,
  createFragment,
  getFragment,
} from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'
import { createFragmentTools } from '@/server/llm/tools'
import { registry } from '@/server/fragments/registry'

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
    it('excludes type-specific tools for built-in types with llmTools: false', () => {
      const tools = createFragmentTools(dataDir, storyId)
      // Built-in types have llmTools: false — no per-type tools generated
      expect(tools).not.toHaveProperty('getProse')
      expect(tools).not.toHaveProperty('getCharacter')
      expect(tools).not.toHaveProperty('getGuideline')
      expect(tools).not.toHaveProperty('getKnowledge')
      expect(tools).not.toHaveProperty('getImage')
      expect(tools).not.toHaveProperty('getIcon')
      expect(tools).not.toHaveProperty('listProse')
      expect(tools).not.toHaveProperty('listCharacters')
      expect(tools).not.toHaveProperty('listGuidelines')
      expect(tools).not.toHaveProperty('listKnowledge')
      expect(tools).not.toHaveProperty('listImages')
      expect(tools).not.toHaveProperty('listIcons')
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
    it('includes write tools when readOnly: false', () => {
      const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
      expect(tools).toHaveProperty('listFragmentTypes')
      // Write tools present
      expect(tools).toHaveProperty('createFragment')
      expect(tools).toHaveProperty('updateFragment')
      expect(tools).toHaveProperty('editFragment')
      expect(tools).toHaveProperty('deleteFragment')
    })
  })

  describe('createFragment (write)', () => {
    it('creates a new fragment in storage', async () => {
      const tools = createFragmentTools(dataDir, storyId, { readOnly: false })
      const result = await tools.createFragment.execute(
        {
          type: 'knowledge',
          name: 'Moon Ritual',
          description: 'How moon magic works',
          content: 'Moon ritual requires silver ash and river water.',
        },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.ok).toBe(true)
      expect(result.id).toMatch(/^kn-/)

      const created = await getFragment(dataDir, storyId, result.id)
      expect(created).toBeTruthy()
      expect(created?.type).toBe('knowledge')
      expect(created?.name).toBe('Moon Ritual')
    })
  })

  describe('llmTools registry flag', () => {
    afterEach(() => {
      // Clean up test type
      registry.unregister('testtype')
    })

    it('generates tools for types with llmTools: true (or undefined)', () => {
      registry.register({
        type: 'testtype',
        prefix: 'tt',
        stickyByDefault: false,
        contextRenderer: (f) => f.content,
        llmTools: true,
      })
      const tools = createFragmentTools(dataDir, storyId)
      expect(tools).toHaveProperty('getTesttype')
      expect(tools).toHaveProperty('listTesttypes')
    })

    it('skips tools for types with llmTools: false', () => {
      registry.register({
        type: 'testtype',
        prefix: 'tt',
        stickyByDefault: false,
        contextRenderer: (f) => f.content,
        llmTools: false,
      })
      const tools = createFragmentTools(dataDir, storyId)
      expect(tools).not.toHaveProperty('getTesttype')
      expect(tools).not.toHaveProperty('listTesttypes')
    })
  })

  describe('type-specific get tool (llmTools: true)', () => {
    afterEach(() => {
      registry.unregister('testtype')
    })

    it('retrieves a fragment by ID via generated get tool', async () => {
      registry.register({
        type: 'testtype',
        prefix: 'tt',
        stickyByDefault: false,
        contextRenderer: (f) => f.content,
        llmTools: true,
      })
      const frag = makeFragment({
        id: 'te-0001',
        type: 'testtype',
        name: 'Test Item',
        content: 'Test content here',
      })
      await createFragment(dataDir, storyId, frag)

      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.getTesttype.execute(
        { id: 'te-0001' },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.content).toBe('Test content here')
      expect(result.name).toBe('Test Item')
    })

    it('returns error for non-existent fragment', async () => {
      registry.register({
        type: 'testtype',
        prefix: 'tt',
        stickyByDefault: false,
        contextRenderer: (f) => f.content,
        llmTools: true,
      })
      const tools = createFragmentTools(dataDir, storyId)
      const result = await tools.getTesttype.execute(
        { id: 'te-9999' },
        { toolCallId: 'tc-1', messages: [] },
      )

      expect(result.error).toBeDefined()
    })
  })

  describe('type-specific list tool (llmTools: true)', () => {
    afterEach(() => {
      registry.unregister('testtype')
    })

    it('lists only fragments of the matching type', async () => {
      registry.register({
        type: 'testtype',
        prefix: 'tt',
        stickyByDefault: false,
        contextRenderer: (f) => f.content,
        llmTools: true,
      })
      const frag1 = makeFragment({
        id: 'te-0001',
        type: 'testtype',
        name: 'Item 1',
        description: 'First item',
      })
      const frag2 = makeFragment({
        id: 'te-0002',
        type: 'testtype',
        name: 'Item 2',
        description: 'Second item',
      })
      const prose = makeFragment({
        id: 'pr-0001',
        type: 'prose',
        name: 'Chapter 1',
        description: 'Opening chapter',
      })
      await createFragment(dataDir, storyId, frag1)
      await createFragment(dataDir, storyId, frag2)
      await createFragment(dataDir, storyId, prose)

      const tools = createFragmentTools(dataDir, storyId)

      const result = await tools.listTesttypes.execute(
        {},
        { toolCallId: 'tc-1', messages: [] },
      )
      expect(result.fragments).toHaveLength(2)
      expect(result.fragments[0]).toHaveProperty('id')
      expect(result.fragments[0]).toHaveProperty('name')
      expect(result.fragments[0]).toHaveProperty('description')
      expect(result.fragments[0]).not.toHaveProperty('content')
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
