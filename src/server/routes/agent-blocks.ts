import { Elysia } from 'elysia'
import { getStory } from '../fragments/storage'
import { agentBlockRegistry } from '../agents/agent-block-registry'
import { modelRoleRegistry } from '../agents/model-role-registry'
import { ensureCoreAgentsRegistered } from '../agents/register-core'
import { listActiveAgents } from '../agents/active-registry'
import { compileBlocks } from '../llm/context-builder'
import { applyBlockConfig } from '../blocks/apply'
import { createScriptHelpers } from '../blocks/script-context'
import { CustomBlockDefinitionSchema } from '../blocks/schema'
import type { BlockOverride } from '../blocks/schema'
import {
  getAgentBlockConfig,
  addAgentCustomBlock,
  updateAgentCustomBlock,
  deleteAgentCustomBlock,
  updateAgentBlockOverrides,
  updateAgentDisabledTools,
} from '../agents/agent-block-storage'

export function agentBlockRoutes(dataDir: string) {
  return new Elysia()
    // List currently running agents for a story
    .get('/stories/:storyId/active-agents', ({ params }) => {
      return listActiveAgents(params.storyId)
    })

    // List all registered model roles (auto-discovered from agents)
    .get('/model-roles', () => {
      ensureCoreAgentsRegistered()
      return modelRoleRegistry.list()
    })
    // List all registered agent block definitions (auto-discovered)
    .get('/agent-blocks', () => {
      ensureCoreAgentsRegistered()
      return agentBlockRegistry.list().map(def => ({
        agentName: def.agentName,
        displayName: def.displayName,
        description: def.description,
        availableTools: def.availableTools ?? [],
      }))
    })

    // Get config + builtin blocks + available tools for an agent
    .get('/stories/:storyId/agent-blocks/:agentName', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const config = await getAgentBlockConfig(dataDir, params.storyId, params.agentName)

      // Build preview context to get default blocks metadata
      const previewCtx = await def.buildPreviewContext(dataDir, params.storyId)
      const defaultBlocks = def.createDefaultBlocks(previewCtx)
      const builtinBlocks = defaultBlocks.map(b => ({
        id: b.id,
        role: b.role,
        order: b.order,
        source: b.source,
        contentPreview: b.content.slice(0, 200),
      }))

      return {
        config,
        builtinBlocks,
        availableTools: def.availableTools ?? [],
      }
    })

    // Compile preview with real story data
    .get('/stories/:storyId/agent-blocks/:agentName/preview', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const previewCtx = await def.buildPreviewContext(dataDir, params.storyId)
      let blocks = def.createDefaultBlocks(previewCtx)
      const config = await getAgentBlockConfig(dataDir, params.storyId, params.agentName)
      blocks = await applyBlockConfig(blocks, config, {
        ...previewCtx,
        ...createScriptHelpers(dataDir, params.storyId),
      })
      const messages = compileBlocks(blocks)
      const blocksMeta = blocks
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === 'system' ? -1 : 1
          return a.order - b.order
        })
        .map(b => ({ id: b.id, name: b.name ?? b.id, role: b.role }))

      return { messages, blocks: blocksMeta, blockCount: blocks.length }
    })

    // Create custom block
    .post('/stories/:storyId/agent-blocks/:agentName/custom', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const parsed = CustomBlockDefinitionSchema.safeParse(body)
      if (!parsed.success) {
        set.status = 422
        return { error: 'Invalid block definition', details: parsed.error.issues }
      }

      const config = await addAgentCustomBlock(dataDir, params.storyId, params.agentName, parsed.data)
      return config
    })

    // Update custom block
    .put('/stories/:storyId/agent-blocks/:agentName/custom/:blockId', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const config = await updateAgentCustomBlock(dataDir, params.storyId, params.agentName, params.blockId, body as Record<string, unknown>)
      if (!config) {
        set.status = 404
        return { error: 'Custom block not found' }
      }
      return config
    })

    // Delete custom block
    .delete('/stories/:storyId/agent-blocks/:agentName/custom/:blockId', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const config = await deleteAgentCustomBlock(dataDir, params.storyId, params.agentName, params.blockId)
      return config
    })

    // Update overrides / blockOrder / disabledTools
    .patch('/stories/:storyId/agent-blocks/:agentName/config', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const { overrides, blockOrder, disabledTools } = body as {
        overrides?: Record<string, unknown>
        blockOrder?: string[]
        disabledTools?: string[]
      }

      // Apply overrides/blockOrder if provided
      if (overrides || blockOrder !== undefined) {
        await updateAgentBlockOverrides(
          dataDir,
          params.storyId,
          params.agentName,
          (overrides ?? {}) as Record<string, BlockOverride>,
          blockOrder,
        )
      }

      // Apply disabledTools if provided
      if (disabledTools !== undefined) {
        await updateAgentDisabledTools(dataDir, params.storyId, params.agentName, disabledTools)
      }

      // Return latest config
      const config = await getAgentBlockConfig(dataDir, params.storyId, params.agentName)
      return config
    })
}
