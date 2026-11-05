import { readFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { z } from 'zod/v4'
import { BlockConfigSchema, type CustomBlockDefinition, type BlockOverride } from '../blocks/schema'
import { getContentRoot } from '../fragments/branches'
import { writeJsonAtomic } from '../fs-utils'
import { withKeyLock } from '../async-lock'
import { createLogger } from '../logging'

const logger = createLogger('agent-block-storage')

export const AgentBlockConfigSchema = BlockConfigSchema.extend({
  disabledTools: z.array(z.string()).default([]),
  disableAutoAnalysis: z.boolean().default(false),
})

export type AgentBlockConfig = z.infer<typeof AgentBlockConfigSchema>

async function agentBlockConfigPath(dataDir: string, storyId: string, agentName: string): Promise<string> {
  const root = await getContentRoot(dataDir, storyId)
  return join(root, 'agent-blocks', `${agentName}.json`)
}

function emptyConfig(): AgentBlockConfig {
  return { customBlocks: [], overrides: {}, blockOrder: [], disabledTools: [], disableAutoAnalysis: false }
}

/**
 * Read the config strictly: a missing file yields the empty default, but an
 * unreadable/corrupt file throws so callers never overwrite it with defaults.
 */
async function readAgentBlockConfigStrict(dataDir: string, storyId: string, agentName: string): Promise<AgentBlockConfig> {
  const path = await agentBlockConfigPath(dataDir, storyId, agentName)
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig()
    throw err
  }
  try {
    return AgentBlockConfigSchema.parse(JSON.parse(raw))
  } catch (err) {
    throw new Error(`Agent block config for ${agentName} is corrupt (${path}): ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Read for use at generation time. A corrupt file falls back to defaults (with a
 * warning) so the agent still runs; mutators use the strict reader and refuse
 * to write over it.
 */
export async function getAgentBlockConfig(dataDir: string, storyId: string, agentName: string): Promise<AgentBlockConfig> {
  try {
    return await readAgentBlockConfigStrict(dataDir, storyId, agentName)
  } catch (err) {
    logger.warn('Using default agent block config', { agentName, error: err instanceof Error ? err.message : String(err) })
    return emptyConfig()
  }
}

function withConfigLock<T>(storyId: string, agentName: string, fn: () => Promise<T>): Promise<T> {
  return withKeyLock(`agent-block-config:${storyId}:${agentName}`, fn)
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
  return withConfigLock(storyId, agentName, async () => {
    const config = await readAgentBlockConfigStrict(dataDir, storyId, agentName)
    config.customBlocks.push(block)
    config.blockOrder.push(block.id)
    await saveAgentBlockConfig(dataDir, storyId, agentName, config)
    return config
  })
}

export async function updateAgentCustomBlock(
  dataDir: string,
  storyId: string,
  agentName: string,
  blockId: string,
  updates: Partial<Omit<CustomBlockDefinition, 'id'>>,
): Promise<AgentBlockConfig | null> {
  return withConfigLock(storyId, agentName, async () => {
    const config = await readAgentBlockConfigStrict(dataDir, storyId, agentName)
    const idx = config.customBlocks.findIndex(b => b.id === blockId)
    if (idx === -1) return null

    config.customBlocks[idx] = { ...config.customBlocks[idx], ...updates }
    await saveAgentBlockConfig(dataDir, storyId, agentName, config)
    return config
  })
}

export async function deleteAgentCustomBlock(
  dataDir: string,
  storyId: string,
  agentName: string,
  blockId: string,
): Promise<AgentBlockConfig> {
  return withConfigLock(storyId, agentName, async () => {
    const config = await readAgentBlockConfigStrict(dataDir, storyId, agentName)
    config.customBlocks = config.customBlocks.filter(b => b.id !== blockId)
    config.blockOrder = config.blockOrder.filter(id => id !== blockId)
    delete config.overrides[blockId]
    await saveAgentBlockConfig(dataDir, storyId, agentName, config)
    return config
  })
}

export async function updateAgentBlockOverrides(
  dataDir: string,
  storyId: string,
  agentName: string,
  overrides: Record<string, BlockOverride>,
  blockOrder?: string[],
): Promise<AgentBlockConfig> {
  return withConfigLock(storyId, agentName, async () => {
    const config = await readAgentBlockConfigStrict(dataDir, storyId, agentName)
    for (const [id, override] of Object.entries(overrides)) {
      config.overrides[id] = { ...config.overrides[id], ...override }
    }
    if (blockOrder !== undefined) {
      config.blockOrder = blockOrder
    }
    await saveAgentBlockConfig(dataDir, storyId, agentName, config)
    return config
  })
}

export async function updateAgentDisabledTools(
  dataDir: string,
  storyId: string,
  agentName: string,
  disabledTools: string[],
): Promise<AgentBlockConfig> {
  return withConfigLock(storyId, agentName, async () => {
    const config = await readAgentBlockConfigStrict(dataDir, storyId, agentName)
    config.disabledTools = disabledTools
    await saveAgentBlockConfig(dataDir, storyId, agentName, config)
    return config
  })
}
