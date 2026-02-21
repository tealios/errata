import type { ToolSet } from 'ai'
import type { ContextBlock, ContextMessage } from '../llm/context-builder'
import { compileBlocks } from '../llm/context-builder'
import { applyBlockConfig } from '../blocks/apply'
import { createScriptHelpers } from '../blocks/script-context'
import { agentBlockRegistry } from './agent-block-registry'
import { getAgentBlockConfig } from './agent-block-storage'
import type { AgentBlockContext } from './agent-block-context'

export interface CompiledAgentContext {
  messages: ContextMessage[]
  blocks: ContextBlock[]
  tools: ToolSet
}

export async function compileAgentContext(
  dataDir: string,
  storyId: string,
  agentName: string,
  blockContext: AgentBlockContext,
  allTools: ToolSet,
): Promise<CompiledAgentContext> {
  const def = agentBlockRegistry.get(agentName)
  if (!def) throw new Error(`No block definition for agent: ${agentName}`)

  // 1. Create default blocks
  let blocks = def.createDefaultBlocks(blockContext)

  // 2. Load and apply config
  const config = await getAgentBlockConfig(dataDir, storyId, agentName)
  const scriptContext = {
    ...blockContext,
    ...createScriptHelpers(dataDir, storyId),
  }
  blocks = await applyBlockConfig(blocks, config, scriptContext)

  // 3. Compile blocks → messages
  const messages = compileBlocks(blocks)

  // 4. Filter tools
  const disabledTools = new Set(config.disabledTools ?? [])
  const tools: ToolSet = {}
  for (const [name, tool] of Object.entries(allTools)) {
    if (!disabledTools.has(name)) tools[name] = tool
  }

  return { messages, blocks, tools }
}
