import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'
import type { StoryMeta } from '@/server/fragments/schema'
import type { CustomBlockDefinition } from '@/server/blocks/schema'
import {
  getAgentBlockConfig,
  saveAgentBlockConfig,
  addAgentCustomBlock,
  updateAgentCustomBlock,
  deleteAgentCustomBlock,
  updateAgentBlockOverrides,
  updateAgentDisabledTools,
} from '@/server/agents/agent-block-storage'

let dataDir: string
let cleanup: () => Promise<void>
const STORY_ID = 'test-story'
const AGENT_NAME = 'librarian.analyze'

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: STORY_ID,
    name: 'Test',
    description: 'Test story',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
  }
}

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
  await createStory(dataDir, makeStory())
})

afterEach(async () => {
  await cleanup()
})

describe('Agent Block Config Storage', () => {
  it('returns empty config for new agent', async () => {
    const config = await getAgentBlockConfig(dataDir, STORY_ID, AGENT_NAME)
    expect(config.customBlocks).toEqual([])
    expect(config.overrides).toEqual({})
    expect(config.blockOrder).toEqual([])
    expect(config.disabledTools).toEqual([])
  })

  it('saves and loads config', async () => {
    await saveAgentBlockConfig(dataDir, STORY_ID, AGENT_NAME, {
      customBlocks: [],
      overrides: { instructions: { enabled: false } },
      blockOrder: ['instructions', 'story-summary'],
      disabledTools: ['reportTimeline'],
    })
    const loaded = await getAgentBlockConfig(dataDir, STORY_ID, AGENT_NAME)
    expect(loaded.overrides.instructions?.enabled).toBe(false)
    expect(loaded.blockOrder).toEqual(['instructions', 'story-summary'])
    expect(loaded.disabledTools).toEqual(['reportTimeline'])
  })

  it('adds a custom block', async () => {
    const block: CustomBlockDefinition = {
      id: 'cb-test01',
      name: 'Test Block',
      role: 'user',
      order: 500,
      enabled: true,
      type: 'simple',
      content: 'Agent custom context',
    }
    const config = await addAgentCustomBlock(dataDir, STORY_ID, AGENT_NAME, block)
    expect(config.customBlocks).toHaveLength(1)
    expect(config.customBlocks[0].id).toBe('cb-test01')
    expect(config.blockOrder).toContain('cb-test01')
  })

  it('updates a custom block', async () => {
    const block: CustomBlockDefinition = {
      id: 'cb-upd001',
      name: 'Original',
      role: 'user',
      order: 100,
      enabled: true,
      type: 'simple',
      content: 'Original content',
    }
    await addAgentCustomBlock(dataDir, STORY_ID, AGENT_NAME, block)
    const config = await updateAgentCustomBlock(dataDir, STORY_ID, AGENT_NAME, 'cb-upd001', {
      name: 'Updated',
      content: 'New content',
    })
    expect(config).not.toBeNull()
    expect(config!.customBlocks[0].name).toBe('Updated')
    expect(config!.customBlocks[0].content).toBe('New content')
  })

  it('returns null when updating non-existent block', async () => {
    const result = await updateAgentCustomBlock(dataDir, STORY_ID, AGENT_NAME, 'cb-noexist', { name: 'Nope' })
    expect(result).toBeNull()
  })

  it('deletes a custom block and cleans up', async () => {
    const block: CustomBlockDefinition = {
      id: 'cb-del001',
      name: 'To Delete',
      role: 'system',
      order: 200,
      enabled: true,
      type: 'simple',
      content: 'Delete me',
    }
    await addAgentCustomBlock(dataDir, STORY_ID, AGENT_NAME, block)
    await updateAgentBlockOverrides(dataDir, STORY_ID, AGENT_NAME, { 'cb-del001': { enabled: false } })
    const config = await deleteAgentCustomBlock(dataDir, STORY_ID, AGENT_NAME, 'cb-del001')
    expect(config.customBlocks).toHaveLength(0)
    expect(config.blockOrder).not.toContain('cb-del001')
    expect(config.overrides['cb-del001']).toBeUndefined()
  })

  it('merges overrides', async () => {
    await updateAgentBlockOverrides(dataDir, STORY_ID, AGENT_NAME, {
      instructions: { enabled: false },
    })
    const config = await updateAgentBlockOverrides(dataDir, STORY_ID, AGENT_NAME, {
      instructions: { contentMode: 'prepend', customContent: 'Extra' },
      'story-summary': { enabled: false },
    })
    expect(config.overrides.instructions?.enabled).toBe(false)
    expect(config.overrides.instructions?.contentMode).toBe('prepend')
    expect(config.overrides['story-summary']?.enabled).toBe(false)
  })

  it('updates blockOrder', async () => {
    const config = await updateAgentBlockOverrides(dataDir, STORY_ID, AGENT_NAME, {}, ['story-summary', 'instructions'])
    expect(config.blockOrder).toEqual(['story-summary', 'instructions'])
  })

  it('updates disabled tools', async () => {
    const config = await updateAgentDisabledTools(dataDir, STORY_ID, AGENT_NAME, ['reportTimeline', 'reportContradictions'])
    expect(config.disabledTools).toEqual(['reportTimeline', 'reportContradictions'])
  })

  it('isolates configs between agents', async () => {
    await saveAgentBlockConfig(dataDir, STORY_ID, 'librarian.analyze', {
      customBlocks: [],
      overrides: { instructions: { enabled: false } },
      blockOrder: [],
      disabledTools: ['reportTimeline'],
    })
    await saveAgentBlockConfig(dataDir, STORY_ID, 'librarian.chat', {
      customBlocks: [],
      overrides: {},
      blockOrder: ['instructions'],
      disabledTools: [],
    })

    const analyzeConfig = await getAgentBlockConfig(dataDir, STORY_ID, 'librarian.analyze')
    const chatConfig = await getAgentBlockConfig(dataDir, STORY_ID, 'librarian.chat')

    expect(analyzeConfig.overrides.instructions?.enabled).toBe(false)
    expect(analyzeConfig.disabledTools).toEqual(['reportTimeline'])
    expect(chatConfig.overrides.instructions).toBeUndefined()
    expect(chatConfig.blockOrder).toEqual(['instructions'])
  })
})
