import { Elysia, t } from 'elysia'
import { getStory } from '../fragments/storage'
import { buildContextState, createDefaultBlocks, compileBlocks } from '../llm/context-builder'
import { getBlockConfig, addCustomBlock, updateCustomBlock, deleteCustomBlock, updateBlockOverrides } from '../blocks/storage'
import { applyBlockConfig } from '../blocks/apply'
import { CustomBlockDefinitionSchema } from '../blocks/schema'
import type { BlockOverride } from '../blocks/schema'

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
      blocks = applyBlockConfig(blocks, blockConfig, ctxState)
      const messages = compileBlocks(blocks)
      const blocksMeta = blocks
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === 'system' ? -1 : 1
          return a.order - b.order
        })
        .map(b => ({ id: b.id, name: b.id, role: b.role }))
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
}
