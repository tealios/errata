import { Elysia } from 'elysia'
import { withStory } from './_helpers'
import { agentBlockRegistry } from '../agents/agent-block-registry'
import { modelRoleRegistry } from '../agents/model-role-registry'
import { ensureCoreAgentsRegistered } from '../agents/register-core'
import { listActiveAgents } from '../agents/active-registry'
import { compileBlocks, expandMessagesFragmentTags } from '../llm/context-builder'
import { getModel } from '../llm/client'
import { applyBlockConfig } from '../blocks/apply'
import { createScriptHelpers } from '../blocks/script-context'
import { CustomBlockDefinitionSchema } from '../blocks/schema'
import type { BlockOverride } from '../blocks/schema'
import {
  getAgentBlockConfig,
  saveAgentBlockConfig,
  addAgentCustomBlock,
  updateAgentCustomBlock,
  deleteAgentCustomBlock,
  updateAgentBlockOverrides,
  updateAgentDisabledTools,
  AgentBlockConfigSchema,
} from '../agents/agent-block-storage'

export function agentBlockRoutes(dataDir: string) {
  // Idempotent; run once so every handler sees a populated registry.
  ensureCoreAgentsRegistered()

  return new Elysia({ detail: { tags: ['Agent Blocks'] } })
    // List currently running agents for a story
    .get('/stories/:storyId/active-agents', ({ params }) => {
      return listActiveAgents(params.storyId)
    }, { detail: { summary: 'List currently running agents' } })

    // List all registered model roles (auto-discovered from agents)
    .get('/model-roles', () => {
      return modelRoleRegistry.list()
    }, { detail: { summary: 'List all registered model roles' } })
    // List all registered agent block definitions (auto-discovered)
    .get('/agent-blocks', () => {
      return agentBlockRegistry.list().map(def => ({
        agentName: def.agentName,
        displayName: def.displayName,
        description: def.description,
        availableTools: def.availableTools ?? [],
      }))
    }, { detail: { summary: 'List all agent block definitions' } })

    // Export a single agent's block config for sharing
    .get('/stories/:storyId/agent-blocks/:agentName/export-config', withStory(dataDir, async (_story, { params, set }) => {
      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const config = await getAgentBlockConfig(dataDir, params.storyId, params.agentName)
      return {
        agentName: params.agentName,
        displayName: def.displayName,
        config,
      }
    }), { detail: { summary: 'Export a single agent block config' } })

    // Import a single agent's block config
    .post('/stories/:storyId/agent-blocks/:agentName/import-config', withStory(dataDir, async (_story, { params, body, set }) => {
      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const { config } = body as { config?: unknown }
      if (!config) {
        set.status = 422
        return { error: 'Missing config field' }
      }

      const parsed = AgentBlockConfigSchema.safeParse(config)
      if (!parsed.success) {
        set.status = 422
        return { error: 'Invalid agent block config', details: parsed.error.issues }
      }

      await saveAgentBlockConfig(dataDir, params.storyId, params.agentName, parsed.data)
      return { ok: true }
    }), { detail: { summary: 'Import a single agent block config' } })

    // Get config + builtin blocks + available tools for an agent
    .get('/stories/:storyId/agent-blocks/:agentName', withStory(dataDir, async (_story, { params, set }) => {
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
        content: b.content,
        contentPreview: b.content.slice(0, 200),
      }))

      return {
        config,
        builtinBlocks,
        availableTools: def.availableTools ?? [],
      }
    }), { detail: { summary: 'Get agent config and builtin blocks' } })

    // Compile preview with real story data
    .get('/stories/:storyId/agent-blocks/:agentName/preview', withStory(dataDir, async (_story, { params, query, set }) => {
      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const previewCtx = await def.buildPreviewContext(dataDir, params.storyId)
      // Allow ?modelId= to preview model-specific instruction overrides
      const modelId = (query as Record<string, string | undefined>).modelId
      if (modelId) {
        previewCtx.modelId = modelId
      } else {
        // Auto-resolve from the agent name (used as the model role key)
        try {
          const resolved = await getModel(dataDir, params.storyId, { role: params.agentName })
          if (resolved.modelId) previewCtx.modelId = resolved.modelId
        } catch {
          // If model resolution fails (no provider configured), leave modelId unset
        }
      }
      let blocks = def.createDefaultBlocks(previewCtx)
      const config = await getAgentBlockConfig(dataDir, params.storyId, params.agentName)
      blocks = await applyBlockConfig(blocks, config, {
        ...previewCtx,
        ...createScriptHelpers(dataDir, params.storyId),
      })
      let messages = compileBlocks(blocks)
      messages = await expandMessagesFragmentTags(messages, dataDir, params.storyId)
      const blocksMeta = blocks
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === 'system' ? -1 : 1
          return a.order - b.order
        })
        .map(b => ({ id: b.id, name: b.name ?? b.id, role: b.role }))

      return { messages, blocks: blocksMeta, blockCount: blocks.length }
    }), { detail: { summary: 'Preview compiled agent context' } })

    // Create custom block
    .post('/stories/:storyId/agent-blocks/:agentName/custom', withStory(dataDir, async (_story, { params, body, set }) => {
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
    }), { detail: { summary: 'Create a custom agent block' } })

    // Update custom block
    .put('/stories/:storyId/agent-blocks/:agentName/custom/:blockId', withStory(dataDir, async (_story, { params, body, set }) => {
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
    }), { detail: { summary: 'Update a custom agent block' } })

    // Delete custom block
    .delete('/stories/:storyId/agent-blocks/:agentName/custom/:blockId', withStory(dataDir, async (_story, { params, set }) => {
      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const config = await deleteAgentCustomBlock(dataDir, params.storyId, params.agentName, params.blockId)
      return config
    }), { detail: { summary: 'Delete a custom agent block' } })

    // Update overrides / blockOrder / disabledTools
    .patch('/stories/:storyId/agent-blocks/:agentName/config', withStory(dataDir, async (_story, { params, body, set }) => {
      const def = agentBlockRegistry.get(params.agentName)
      if (!def) {
        set.status = 404
        return { error: `Agent block definition not found: ${params.agentName}` }
      }

      const { overrides, blockOrder, disabledTools, disableAutoAnalysis } = body as {
        overrides?: Record<string, unknown>
        blockOrder?: string[]
        disabledTools?: string[]
        disableAutoAnalysis?: boolean
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

      const config = await getAgentBlockConfig(dataDir, params.storyId, params.agentName)
      if (disableAutoAnalysis !== undefined) {
        config.disableAutoAnalysis = disableAutoAnalysis
        await saveAgentBlockConfig(dataDir, params.storyId, params.agentName, config)
      }

      return config
    }), { detail: { summary: 'Update agent block config' } })
}
