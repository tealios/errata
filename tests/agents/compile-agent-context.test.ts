import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod/v4'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'
import type { StoryMeta } from '@/server/fragments/schema'
import { ensureCoreAgentsRegistered } from '@/server/agents'
import { compileAgentContext } from '@/server/agents/compile-agent-context'
import { saveAgentBlockConfig } from '@/server/agents/agent-block-storage'
import type { AgentBlockContext } from '@/server/agents/agent-block-context'

let dataDir: string
let cleanup: () => Promise<void>
const STORY_ID = 'test-story'
const now = new Date().toISOString()

function makeStory(): StoryMeta {
  return {
    id: STORY_ID,
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: 'The hero began the journey.',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
  }
}

function makeContext(overrides: Partial<AgentBlockContext> = {}): AgentBlockContext {
  return {
    story: makeStory(),
    proseFragments: [],
    stickyGuidelines: [],
    stickyKnowledge: [],
    stickyCharacters: [],
    guidelineShortlist: [],
    knowledgeShortlist: [],
    characterShortlist: [],
    systemPromptFragments: [],
    ...overrides,
  }
}

function makeDummyTools() {
  return {
    toolA: tool({
      description: 'Tool A',
      inputSchema: z.object({ x: z.string() }),
      execute: async () => 'a',
    }),
    toolB: tool({
      description: 'Tool B',
      inputSchema: z.object({ y: z.string() }),
      execute: async () => 'b',
    }),
    toolC: tool({
      description: 'Tool C',
      inputSchema: z.object({ z: z.string() }),
      execute: async () => 'c',
    }),
  }
}

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
  await createStory(dataDir, makeStory())
  ensureCoreAgentsRegistered()
})

afterEach(async () => {
  await cleanup()
})

describe('compileAgentContext', () => {
  it('compiles default blocks into messages', async () => {
    const ctx = makeContext({
      newProse: { id: 'pr-test01', content: 'The hero drew their sword.' },
    })
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.analyze', ctx, {})
    expect(result.messages.length).toBeGreaterThan(0)
    expect(result.blocks.length).toBeGreaterThan(0)

    // Should have system and user messages
    const roles = result.messages.map(m => m.role)
    expect(roles).toContain('system')
    expect(roles).toContain('user')
  })

  it('throws for unknown agent', async () => {
    await expect(
      compileAgentContext(dataDir, STORY_ID, 'nonexistent', makeContext(), {})
    ).rejects.toThrow('No block definition for agent: nonexistent')
  })

  it('passes all tools through with no config', async () => {
    const tools = makeDummyTools()
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.analyze', makeContext(), tools)
    expect(Object.keys(result.tools)).toEqual(['toolA', 'toolB', 'toolC'])
  })

  it('filters disabled tools from config', async () => {
    const tools = makeDummyTools()
    await saveAgentBlockConfig(dataDir, STORY_ID, 'librarian.analyze', {
      customBlocks: [],
      overrides: {},
      blockOrder: [],
      disabledTools: ['toolB'],
    })
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.analyze', makeContext(), tools)
    expect(Object.keys(result.tools)).toEqual(['toolA', 'toolC'])
    expect(result.tools.toolB).toBeUndefined()
  })

  it('applies block overrides from config', async () => {
    await saveAgentBlockConfig(dataDir, STORY_ID, 'librarian.analyze', {
      customBlocks: [],
      overrides: {
        'story-summary': { enabled: false },
      },
      blockOrder: [],
      disabledTools: [],
    })
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.analyze', makeContext(), {})
    const blockIds = result.blocks.map(b => b.id)
    expect(blockIds).toContain('instructions')
    expect(blockIds).not.toContain('story-summary')
  })

  it('applies content override from config', async () => {
    await saveAgentBlockConfig(dataDir, STORY_ID, 'librarian.analyze', {
      customBlocks: [],
      overrides: {
        instructions: { contentMode: 'prepend', customContent: 'IMPORTANT: Focus on dialogue.' },
      },
      blockOrder: [],
      disabledTools: [],
    })
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.analyze', makeContext(), {})
    const instBlock = result.blocks.find(b => b.id === 'instructions')!
    expect(instBlock.content).toMatch(/^IMPORTANT: Focus on dialogue\./)
  })

  it('includes custom blocks from config', async () => {
    await saveAgentBlockConfig(dataDir, STORY_ID, 'librarian.analyze', {
      customBlocks: [{
        id: 'cb-extra1',
        name: 'Extra Context',
        role: 'user',
        order: 350,
        enabled: true,
        type: 'simple',
        content: 'Additional analysis rules go here.',
      }],
      overrides: {},
      blockOrder: [],
      disabledTools: [],
    })
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.analyze', makeContext(), {})
    const customBlock = result.blocks.find(b => b.id === 'cb-extra1')
    expect(customBlock).toBeDefined()
    expect(customBlock!.content).toBe('Additional analysis rules go here.')
    expect(customBlock!.source).toBe('custom')
  })

  it('applies blockOrder reordering', async () => {
    const ctx = makeContext({
      newProse: { id: 'pr-test01', content: 'Prose content' },
    })
    await saveAgentBlockConfig(dataDir, STORY_ID, 'librarian.analyze', {
      customBlocks: [],
      overrides: {},
      blockOrder: ['new-prose', 'story-summary', 'instructions'],
      disabledTools: [],
    })
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.analyze', ctx, {})
    const proseBlock = result.blocks.find(b => b.id === 'new-prose')!
    const summaryBlock = result.blocks.find(b => b.id === 'story-summary')!
    const instBlock = result.blocks.find(b => b.id === 'instructions')!
    expect(proseBlock.order).toBeLessThan(summaryBlock.order)
    expect(summaryBlock.order).toBeLessThan(instBlock.order)
  })

  it('works with librarian.chat agent', async () => {
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.chat', makeContext(), {})
    expect(result.messages.length).toBeGreaterThan(0)
    const blockIds = result.blocks.map(b => b.id)
    expect(blockIds).toContain('instructions')
    expect(blockIds).toContain('story-info')
  })

  it('works with librarian.refine agent', async () => {
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.refine', makeContext(), {})
    expect(result.messages.length).toBeGreaterThan(0)
    const blockIds = result.blocks.map(b => b.id)
    expect(blockIds).toContain('instructions')
    expect(blockIds).toContain('story-info')
  })

  it('works with librarian.prose-transform agent', async () => {
    const ctx = makeContext({
      operation: 'rewrite',
      selectedText: 'The hero walked.',
    })
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.prose-transform', ctx, {})
    expect(result.messages.length).toBeGreaterThan(0)
    const blockIds = result.blocks.map(b => b.id)
    expect(blockIds).toContain('instructions')
    expect(blockIds).toContain('story-summary')
  })

  it('works with character-chat.chat agent', async () => {
    const result = await compileAgentContext(dataDir, STORY_ID, 'character-chat.chat', makeContext(), {})
    expect(result.messages.length).toBeGreaterThan(0)
    const blockIds = result.blocks.map(b => b.id)
    expect(blockIds).toContain('story-context')
  })

  it('script custom blocks receive agent context', async () => {
    await saveAgentBlockConfig(dataDir, STORY_ID, 'librarian.analyze', {
      customBlocks: [{
        id: 'cb-script1',
        name: 'Script Block',
        role: 'user',
        order: 500,
        enabled: true,
        type: 'script',
        content: 'return `Analyzing story: ${ctx.story.name}`',
      }],
      overrides: {},
      blockOrder: [],
      disabledTools: [],
    })
    const result = await compileAgentContext(dataDir, STORY_ID, 'librarian.analyze', makeContext(), {})
    const scriptBlock = result.blocks.find(b => b.id === 'cb-script1')
    expect(scriptBlock).toBeDefined()
    expect(scriptBlock!.content).toBe('Analyzing story: Test Story')
  })
})
