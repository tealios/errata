import { describe, it, expect } from 'vitest'
import { makeTestSettings } from '../setup'
import { applyBlockConfig } from '@/server/blocks/apply'
import type { ContextBlock, ContextBuildState } from '@/server/llm/context-builder'
import type { BlockConfig } from '@/server/blocks/schema'

function makeState(overrides: Partial<ContextBuildState> = {}): ContextBuildState {
  const now = new Date().toISOString()
  return {
    story: {
      id: 'story-test',
      name: 'Test Story',
      description: 'A test story',
      summary: '',
      createdAt: now,
      updatedAt: now,
      settings: makeTestSettings(),
    },
    proseFragments: [],
    chapterSummaries: [],
    stickyGuidelines: [],
    stickyKnowledge: [],
    stickyCharacters: [],
    guidelineShortlist: [],
    knowledgeShortlist: [],
    characterShortlist: [],
    authorInput: 'Continue the story',
    ...overrides,
  }
}

function makeBlocks(): ContextBlock[] {
  return [
    { id: 'instructions', role: 'system', content: 'You are a writing assistant.', order: 100, source: 'builtin' },
    { id: 'tools', role: 'system', content: '## Available Tools', order: 200, source: 'builtin' },
    { id: 'story-info', role: 'user', content: '## Story: Test', order: 100, source: 'builtin' },
    { id: 'author-input', role: 'user', content: 'Continue the story', order: 600, source: 'builtin' },
  ]
}

function emptyConfig(): BlockConfig {
  return { customBlocks: [], overrides: {}, blockOrder: [] }
}

describe('applyBlockConfig', () => {
  it('passes through blocks unchanged with empty config', () => {
    const blocks = makeBlocks()
    const result = applyBlockConfig(blocks, emptyConfig(), makeState())
    expect(result).toHaveLength(4)
    expect(result.map(b => b.id)).toEqual(['instructions', 'tools', 'story-info', 'author-input'])
  })

  it('inserts simple custom blocks', () => {
    const config: BlockConfig = {
      customBlocks: [{
        id: 'cb-test01',
        name: 'Custom',
        role: 'user',
        order: 350,
        enabled: true,
        type: 'simple',
        content: 'Custom content here',
      }],
      overrides: {},
      blockOrder: [],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    const custom = result.find(b => b.id === 'cb-test01')
    expect(custom).toBeDefined()
    expect(custom!.content).toBe('Custom content here')
    expect(custom!.source).toBe('custom')
  })

  it('evaluates script custom blocks', () => {
    const config: BlockConfig = {
      customBlocks: [{
        id: 'cb-script',
        name: 'Script',
        role: 'system',
        order: 150,
        enabled: true,
        type: 'script',
        content: 'return `Story: ${ctx.story.name}`',
      }],
      overrides: {},
      blockOrder: [],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    const script = result.find(b => b.id === 'cb-script')
    expect(script).toBeDefined()
    expect(script!.content).toBe('Story: Test Story')
  })

  it('handles script errors gracefully', () => {
    const config: BlockConfig = {
      customBlocks: [{
        id: 'cb-broken',
        name: 'Broken',
        role: 'user',
        order: 200,
        enabled: true,
        type: 'script',
        content: 'throw new Error("boom")',
      }],
      overrides: {},
      blockOrder: [],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    const broken = result.find(b => b.id === 'cb-broken')
    expect(broken).toBeDefined()
    expect(broken!.content).toContain('Script error')
  })

  it('skips script blocks that return empty string', () => {
    const config: BlockConfig = {
      customBlocks: [{
        id: 'cb-empty',
        name: 'Empty',
        role: 'user',
        order: 200,
        enabled: true,
        type: 'script',
        content: 'return ""',
      }],
      overrides: {},
      blockOrder: [],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    expect(result.find(b => b.id === 'cb-empty')).toBeUndefined()
  })

  it('applies content override', () => {
    const config: BlockConfig = {
      customBlocks: [],
      overrides: {
        instructions: { contentMode: 'override', customContent: 'New instructions' },
      },
      blockOrder: [],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    const inst = result.find(b => b.id === 'instructions')
    expect(inst!.content).toBe('New instructions')
  })

  it('applies content prepend', () => {
    const config: BlockConfig = {
      customBlocks: [],
      overrides: {
        instructions: { contentMode: 'prepend', customContent: 'IMPORTANT:' },
      },
      blockOrder: [],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    const inst = result.find(b => b.id === 'instructions')
    expect(inst!.content).toBe('IMPORTANT:\nYou are a writing assistant.')
  })

  it('applies content append', () => {
    const config: BlockConfig = {
      customBlocks: [],
      overrides: {
        instructions: { contentMode: 'append', customContent: 'Be creative.' },
      },
      blockOrder: [],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    const inst = result.find(b => b.id === 'instructions')
    expect(inst!.content).toBe('You are a writing assistant.\nBe creative.')
  })

  it('removes disabled blocks', () => {
    const config: BlockConfig = {
      customBlocks: [],
      overrides: { tools: { enabled: false } },
      blockOrder: [],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    expect(result.find(b => b.id === 'tools')).toBeUndefined()
    expect(result).toHaveLength(3)
  })

  it('applies blockOrder reordering', () => {
    const config: BlockConfig = {
      customBlocks: [],
      overrides: {},
      blockOrder: ['tools', 'instructions', 'author-input', 'story-info'],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    // tools gets order=0, instructions gets order=1
    const tools = result.find(b => b.id === 'tools')!
    const instructions = result.find(b => b.id === 'instructions')!
    expect(tools.order).toBe(0)
    expect(instructions.order).toBe(1)
    expect(tools.order).toBeLessThan(instructions.order)
  })

  it('skips disabled custom blocks', () => {
    const config: BlockConfig = {
      customBlocks: [{
        id: 'cb-dis001',
        name: 'Disabled',
        role: 'user',
        order: 200,
        enabled: false,
        type: 'simple',
        content: 'Should not appear',
      }],
      overrides: {},
      blockOrder: [],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    expect(result.find(b => b.id === 'cb-dis001')).toBeUndefined()
  })

  it('disables custom blocks via override', () => {
    const config: BlockConfig = {
      customBlocks: [{
        id: 'cb-over01',
        name: 'Override Disabled',
        role: 'user',
        order: 200,
        enabled: true,
        type: 'simple',
        content: 'Visible content',
      }],
      overrides: { 'cb-over01': { enabled: false } },
      blockOrder: [],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())
    expect(result.find(b => b.id === 'cb-over01')).toBeUndefined()
  })

  it('combines multiple transformations', () => {
    const config: BlockConfig = {
      customBlocks: [{
        id: 'cb-combo1',
        name: 'Custom Block',
        role: 'system',
        order: 150,
        enabled: true,
        type: 'simple',
        content: 'Extra context',
      }],
      overrides: {
        tools: { enabled: false },
        instructions: { contentMode: 'append', customContent: 'Stay focused.' },
      },
      blockOrder: ['cb-combo1', 'instructions', 'story-info', 'author-input'],
    }
    const result = applyBlockConfig(makeBlocks(), config, makeState())

    // tools should be removed
    expect(result.find(b => b.id === 'tools')).toBeUndefined()

    // instructions should have appended content
    const inst = result.find(b => b.id === 'instructions')
    expect(inst!.content).toContain('Stay focused.')

    // custom block should exist
    expect(result.find(b => b.id === 'cb-combo1')).toBeDefined()

    // Order: cb-combo1 (order=0) < instructions (order=1)
    const combo = result.find(b => b.id === 'cb-combo1')!
    const inst2 = result.find(b => b.id === 'instructions')!
    expect(combo.order).toBeLessThan(inst2.order)
  })
})
