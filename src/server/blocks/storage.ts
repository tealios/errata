import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { BlockConfigSchema } from './schema'
import type { BlockConfig, CustomBlockDefinition, BlockOverride } from './schema'
import { getContentRoot } from '../fragments/branches'
import { writeJsonAtomic } from '../fs-utils'

async function blockConfigPath(dataDir: string, storyId: string): Promise<string> {
  const root = await getContentRoot(dataDir, storyId)
  return join(root, 'block-config.json')
}

function emptyConfig(): BlockConfig {
  return { customBlocks: [], overrides: {}, blockOrder: [] }
}

export async function getBlockConfig(dataDir: string, storyId: string): Promise<BlockConfig> {
  const path = await blockConfigPath(dataDir, storyId)
  if (!existsSync(path)) return emptyConfig()

  try {
    const raw = await readFile(path, 'utf-8')
    return BlockConfigSchema.parse(JSON.parse(raw))
  } catch {
    return emptyConfig()
  }
}

export async function saveBlockConfig(dataDir: string, storyId: string, config: BlockConfig): Promise<void> {
  const path = await blockConfigPath(dataDir, storyId)
  await writeJsonAtomic(path, config)
}

export async function addCustomBlock(
  dataDir: string,
  storyId: string,
  block: CustomBlockDefinition,
): Promise<BlockConfig> {
  const config = await getBlockConfig(dataDir, storyId)
  config.customBlocks.push(block)
  config.blockOrder.push(block.id)
  await saveBlockConfig(dataDir, storyId, config)
  return config
}

export async function updateCustomBlock(
  dataDir: string,
  storyId: string,
  blockId: string,
  updates: Partial<Omit<CustomBlockDefinition, 'id'>>,
): Promise<BlockConfig | null> {
  const config = await getBlockConfig(dataDir, storyId)
  const idx = config.customBlocks.findIndex(b => b.id === blockId)
  if (idx === -1) return null

  config.customBlocks[idx] = { ...config.customBlocks[idx], ...updates }
  await saveBlockConfig(dataDir, storyId, config)
  return config
}

export async function deleteCustomBlock(
  dataDir: string,
  storyId: string,
  blockId: string,
): Promise<BlockConfig> {
  const config = await getBlockConfig(dataDir, storyId)
  config.customBlocks = config.customBlocks.filter(b => b.id !== blockId)
  config.blockOrder = config.blockOrder.filter(id => id !== blockId)
  delete config.overrides[blockId]
  await saveBlockConfig(dataDir, storyId, config)
  return config
}

export async function updateBlockOverrides(
  dataDir: string,
  storyId: string,
  overrides: Record<string, BlockOverride>,
  blockOrder?: string[],
): Promise<BlockConfig> {
  const config = await getBlockConfig(dataDir, storyId)
  // Merge overrides
  for (const [id, override] of Object.entries(overrides)) {
    config.overrides[id] = { ...config.overrides[id], ...override }
  }
  if (blockOrder !== undefined) {
    config.blockOrder = blockOrder
  }
  await saveBlockConfig(dataDir, storyId, config)
  return config
}
