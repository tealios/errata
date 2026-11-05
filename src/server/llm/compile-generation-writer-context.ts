import type { ToolSet } from 'ai'
import type { WritingPlugin } from '../plugins/types'
import type { BuildContextOptions, ContextBlock, ContextBuildState, ContextMessage } from './context-builder'
import { buildContextState, createDefaultBlocks, compileBlocks, expandMessagesFragmentTags } from './context-builder'
import { getAgentBlockConfig } from '../agents/agent-block-storage'
import { applyBlockConfig } from '../blocks/apply'
import { createScriptHelpers } from '../blocks/script-context'
import { runBeforeBlocks, runBeforeContext, runBeforeGeneration } from '../plugins/hooks'
import { collectPluginToolsWithOrigin } from '../plugins/tools'
import { createFragmentTools } from './tools'

export interface CompiledGenerationWriterContext {
  ctxState: ContextBuildState
  blocks: ContextBlock[]
  messages: ContextMessage[]
  tools: ToolSet
  pluginToolDescriptions: Array<{
    name: string
    description: string
    pluginName?: string
  }>
}

export async function compileGenerationWriterContext(args: {
  dataDir: string
  storyId: string
  authorInput: string
  enabledPlugins: WritingPlugin[]
  contextOptions?: BuildContextOptions
  modelId?: string
}): Promise<CompiledGenerationWriterContext> {
  const { dataDir, storyId, authorInput, enabledPlugins, contextOptions, modelId } = args

  let ctxState = await buildContextState(dataDir, storyId, authorInput, contextOptions)
  ctxState = await runBeforeContext(enabledPlugins, ctxState)
  if (modelId) ctxState.modelId = modelId

  const fragmentTools = createFragmentTools(dataDir, storyId, { readOnly: true })
  const { tools: pluginTools, origins: pluginToolOrigins } = collectPluginToolsWithOrigin(enabledPlugins, dataDir, storyId, Object.keys(fragmentTools))
  const allTools = { ...pluginTools, ...fragmentTools }

  const pluginToolDescriptions = Object.entries(pluginTools).map(([name, tool]) => ({
    name,
    description: (tool as { description?: string }).description ?? '',
    pluginName: pluginToolOrigins[name],
  }))

  const agentConfig = await getAgentBlockConfig(dataDir, storyId, 'generation.writer')
  const disabledTools = new Set(agentConfig.disabledTools ?? [])
  const tools: ToolSet = {}
  for (const [name, tool] of Object.entries(allTools)) {
    if (!disabledTools.has(name)) tools[name] = tool
  }

  let blocks = createDefaultBlocks(
    ctxState,
    pluginToolDescriptions.length > 0 ? { extraTools: pluginToolDescriptions } : undefined,
  )
  blocks = await applyBlockConfig(blocks, agentConfig, {
    ...ctxState,
    ...createScriptHelpers(dataDir, storyId),
  })
  blocks = await runBeforeBlocks(enabledPlugins, blocks)

  let messages = compileBlocks(blocks)
  messages = await expandMessagesFragmentTags(messages, dataDir, storyId)
  messages = await runBeforeGeneration(enabledPlugins, messages)

  return {
    ctxState,
    blocks,
    messages,
    tools,
    pluginToolDescriptions,
  }
}
