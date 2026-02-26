import { readFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { z } from 'zod/v4'
import { BlockConfigSchema, type CustomBlockDefinition, type BlockOverride } from '../blocks/schema'
import { getContentRoot } from '../fragments/branches'
import { writeJsonAtomic } from '../fs-utils'

export const AgentBlockConfigSchema = BlockConfigSchema.extend({
  disabledTools: z.array(z.string()).default([]),
})

export type AgentBlockConfig = z.infer<typeof AgentBlockConfigSchema>

async function agentBlockConfigPath(dataDir: string, storyId: string, agentName: string): Promise<string> {
  const root = await getContentRoot(dataDir, storyId)
  return join(root, 'agent-blocks', `${agentName}.json`)
}

function emptyConfig(): AgentBlockConfig {
  return { customBlocks: [], overrides: {}, blockOrder: [], disabledTools: [] }
}

export async function getAgentBlockConfig(dataDir: string, storyId: string, agentName: string): Promise<AgentBlockConfig> {
  const path = await agentBlockConfigPath(dataDir, storyId, agentName)
  if (!existsSync(path)) return emptyConfig()

  try {
    const raw = await readFile(path, 'utf-8')
    return AgentBlockConfigSchema.parse(JSON.parse(raw))
  } catch {
    return emptyConfig()
  }
}

export async function saveAgentBlockConfig(dataDir: string, storyId: string, agentName: string, config: AgentBlockConfig): Promise<void> {
  const path = await agentBlockConfigPath(dataDir, storyId, agentName)
  await mkdir(dirname(path), { recursive: true })
  await writeJsonAtomic(path, config)
}

export async function addAgentCustomBlock(
  dataDir: string,
  storyId: string,
  agentName: string,
  block: CustomBlockDefinition,
): Promise<AgentBlockConfig> {
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  config.customBlocks.push(block)
  config.blockOrder.push(block.id)
  await saveAgentBlockConfig(dataDir, storyId, agentName, config)
  return config
}

export async function updateAgentCustomBlock(
  dataDir: string,
  storyId: string,
  agentName: string,
  blockId: string,
  updates: Partial<Omit<CustomBlockDefinition, 'id'>>,
): Promise<AgentBlockConfig | null> {
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  const idx = config.customBlocks.findIndex(b => b.id === blockId)
  if (idx === -1) return null

  config.customBlocks[idx] = { ...config.customBlocks[idx], ...updates }
  await saveAgentBlockConfig(dataDir, storyId, agentName, config)
  return config
}

export async function deleteAgentCustomBlock(
  dataDir: string,
  storyId: string,
  agentName: string,
  blockId: string,
): Promise<AgentBlockConfig> {
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  config.customBlocks = config.customBlocks.filter(b => b.id !== blockId)
  config.blockOrder = config.blockOrder.filter(id => id !== blockId)
  delete config.overrides[blockId]
  await saveAgentBlockConfig(dataDir, storyId, agentName, config)
  return config
}

export async function updateAgentBlockOverrides(
  dataDir: string,
  storyId: string,
  agentName: string,
  overrides: Record<string, BlockOverride>,
  blockOrder?: string[],
): Promise<AgentBlockConfig> {
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  for (const [id, override] of Object.entries(overrides)) {
    config.overrides[id] = { ...config.overrides[id], ...override }
  }
  if (blockOrder !== undefined) {
    config.blockOrder = blockOrder
  }
  await saveAgentBlockConfig(dataDir, storyId, agentName, config)
  return config
}

export async function updateAgentDisabledTools(
  dataDir: string,
  storyId: string,
  agentName: string,
  disabledTools: string[],
): Promise<AgentBlockConfig> {
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  config.disabledTools = disabledTools
  await saveAgentBlockConfig(dataDir, storyId, agentName, config)
  return config
}
