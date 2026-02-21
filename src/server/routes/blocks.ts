import { Elysia, t } from 'elysia'
import { getStory } from '../fragments/storage'
import { buildContextState, createDefaultBlocks, compileBlocks } from '../llm/context-builder'
import { getBlockConfig, saveBlockConfig, addCustomBlock, updateCustomBlock, deleteCustomBlock, updateBlockOverrides } from '../blocks/storage'
import { applyBlockConfig } from '../blocks/apply'
import { createScriptHelpers } from '../blocks/script-context'
import { CustomBlockDefinitionSchema, BlockConfigSchema } from '../blocks/schema'
import type { BlockOverride, BlockConfig } from '../blocks/schema'
import { agentBlockRegistry } from '../agents/agent-block-registry'
import { ensureCoreAgentsRegistered } from '../agents/register-core'
import { getAgentBlockConfig, saveAgentBlockConfig, type AgentBlockConfig } from '../agents/agent-block-storage'

export function blockRoutes(dataDir: string) {
  return new Elysia()
    .get('/stories/:storyId/blocks', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const config = await getBlockConfig(dataDir, params.storyId)
      // Build default blocks for metadata
      const ctxState = await buildContextState(dataDir, params.storyId, '(preview)')
      const defaultBlocks = createDefaultBlocks(ctxState)
      const builtinBlocks = defaultBlocks.map(b => ({
        id: b.id,
        role: b.role,
        order: b.order,
        source: b.source,
        contentPreview: b.content.slice(0, 200),
      }))
      return { config, builtinBlocks }
    })

    .get('/stories/:storyId/blocks/preview', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const ctxState = await buildContextState(dataDir, params.storyId, '(preview)')
      let blocks = createDefaultBlocks(ctxState)
      const blockConfig = await getBlockConfig(dataDir, params.storyId)
      blocks = await applyBlockConfig(blocks, blockConfig, {
        ...ctxState,
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

    .post('/stories/:storyId/blocks/custom', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const parsed = CustomBlockDefinitionSchema.safeParse(body)
      if (!parsed.success) {
        set.status = 422
        return { error: 'Invalid block definition', details: parsed.error.issues }
      }
      const config = await addCustomBlock(dataDir, params.storyId, parsed.data)
      return config
    })

    .put('/stories/:storyId/blocks/custom/:blockId', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const config = await updateCustomBlock(dataDir, params.storyId, params.blockId, body as Record<string, unknown>)
      if (!config) {
        set.status = 404
        return { error: 'Custom block not found' }
      }
      return config
    })

    .delete('/stories/:storyId/blocks/custom/:blockId', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const config = await deleteCustomBlock(dataDir, params.storyId, params.blockId)
      return config
    })

    .post('/stories/:storyId/blocks/eval-script', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const { content } = body as { content?: string }
      if (typeof content !== 'string') {
        set.status = 422
        return { error: 'Missing content field' }
      }
      const ctxState = await buildContextState(dataDir, params.storyId, '(preview)')
      const scriptContext = {
        ...ctxState,
        ...createScriptHelpers(dataDir, params.storyId),
      }
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
      try {
        const fn = new AsyncFunction('ctx', content)
        const result = await fn(scriptContext)
        if (typeof result !== 'string' || result.trim() === '') {
          return { result: null, error: null }
        }
        return { result, error: null }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { result: null, error: msg }
      }
    })

    .patch('/stories/:storyId/blocks/config', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }
      const { overrides, blockOrder } = body as { overrides?: Record<string, unknown>; blockOrder?: string[] }
      const config = await updateBlockOverrides(
        dataDir,
        params.storyId,
        (overrides ?? {}) as Record<string, BlockOverride>,
        blockOrder,
      )
      return config
    })

    .get('/stories/:storyId/export-configs', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const blockConfig = await getBlockConfig(dataDir, params.storyId)
      const isBlockEmpty =
        blockConfig.customBlocks.length === 0 &&
        Object.keys(blockConfig.overrides).length === 0 &&
        blockConfig.blockOrder.length === 0

      ensureCoreAgentsRegistered()
      const agentDefs = agentBlockRegistry.list()
      const agentBlockConfigs: Record<string, AgentBlockConfig> = {}
      for (const def of agentDefs) {
        const cfg = await getAgentBlockConfig(dataDir, params.storyId, def.agentName)
        const isEmpty =
          cfg.customBlocks.length === 0 &&
          Object.keys(cfg.overrides).length === 0 &&
          cfg.blockOrder.length === 0 &&
          cfg.disabledTools.length === 0
        if (!isEmpty) {
          agentBlockConfigs[def.agentName] = cfg
        }
      }

      return {
        ...(isBlockEmpty ? {} : { blockConfig }),
        ...(Object.keys(agentBlockConfigs).length > 0 ? { agentBlockConfigs } : {}),
      }
    })

    .post('/stories/:storyId/import-configs', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const { blockConfig, agentBlockConfigs } = body as {
        blockConfig?: BlockConfig
        agentBlockConfigs?: Record<string, AgentBlockConfig>
      }

      if (blockConfig) {
        const parsed = BlockConfigSchema.safeParse(blockConfig)
        if (parsed.success) {
          await saveBlockConfig(dataDir, params.storyId, parsed.data)
        }
      }

      if (agentBlockConfigs) {
        for (const [agentName, cfg] of Object.entries(agentBlockConfigs)) {
          await saveAgentBlockConfig(dataDir, params.storyId, agentName, cfg)
        }
      }

      return { ok: true }
    })
}
