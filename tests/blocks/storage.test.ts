import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'
import type { StoryMeta } from '@/server/fragments/schema'
import {
  getBlockConfig,
  saveBlockConfig,
  addCustomBlock,
  updateCustomBlock,
  deleteCustomBlock,
  updateBlockOverrides,
} from '@/server/blocks/storage'
import type { BlockConfig, CustomBlockDefinition } from '@/server/blocks/schema'

let dataDir: string
let cleanup: () => Promise<void>
const STORY_ID = 'test-story'

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: STORY_ID,
    name: 'Test',
    description: 'Test story',
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

describe('Block Config Storage', () => {
  it('returns empty config for new story', async () => {
    const config = await getBlockConfig(dataDir, STORY_ID)
    expect(config.customBlocks).toEqual([])
    expect(config.overrides).toEqual({})
    expect(config.blockOrder).toEqual([])
  })

  it('saves and loads config', async () => {
    const config: BlockConfig = {
      customBlocks: [],
      overrides: { instructions: { enabled: false } },
      blockOrder: ['instructions', 'tools'],
    }
    await saveBlockConfig(dataDir, STORY_ID, config)
    const loaded = await getBlockConfig(dataDir, STORY_ID)
    expect(loaded.overrides.instructions?.enabled).toBe(false)
    expect(loaded.blockOrder).toEqual(['instructions', 'tools'])
  })

  it('adds a custom block', async () => {
    const block: CustomBlockDefinition = {
      id: 'cb-test01',
      name: 'Test Block',
      role: 'user',
      order: 500,
      enabled: true,
      type: 'simple',
      content: 'Hello world',
    }
    const config = await addCustomBlock(dataDir, STORY_ID, block)
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
    await addCustomBlock(dataDir, STORY_ID, block)
    const config = await updateCustomBlock(dataDir, STORY_ID, 'cb-upd001', {
      name: 'Updated',
      content: 'New content',
    })
    expect(config).not.toBeNull()
    expect(config!.customBlocks[0].name).toBe('Updated')
    expect(config!.customBlocks[0].content).toBe('New content')
  })

  it('returns null when updating non-existent block', async () => {
    const result = await updateCustomBlock(dataDir, STORY_ID, 'cb-noexist', { name: 'Nope' })
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
    await addCustomBlock(dataDir, STORY_ID, block)
    await updateBlockOverrides(dataDir, STORY_ID, { 'cb-del001': { enabled: false } })
    const config = await deleteCustomBlock(dataDir, STORY_ID, 'cb-del001')
    expect(config.customBlocks).toHaveLength(0)
    expect(config.blockOrder).not.toContain('cb-del001')
    expect(config.overrides['cb-del001']).toBeUndefined()
  })

  it('merges overrides', async () => {
    await updateBlockOverrides(dataDir, STORY_ID, {
      instructions: { enabled: false },
    })
    const config = await updateBlockOverrides(dataDir, STORY_ID, {
      instructions: { contentMode: 'prepend', customContent: 'Extra' },
      tools: { enabled: false },
    })
    expect(config.overrides.instructions?.enabled).toBe(false)
    expect(config.overrides.instructions?.contentMode).toBe('prepend')
    expect(config.overrides.instructions?.customContent).toBe('Extra')
    expect(config.overrides.tools?.enabled).toBe(false)
  })

  it('updates blockOrder', async () => {
    const config = await updateBlockOverrides(dataDir, STORY_ID, {}, ['tools', 'instructions'])
    expect(config.blockOrder).toEqual(['tools', 'instructions'])
  })
})
