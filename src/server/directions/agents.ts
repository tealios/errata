import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import { agentBlockRegistry } from '../agents/agent-block-registry'
import { modelRoleRegistry } from '../agents/model-role-registry'
import type { AgentDefinition } from '../agents/types'
import { suggestDirections } from './suggest'
import { createDirectionsSuggestBlocks, buildDirectionsPreviewContext } from './blocks'

const SuggestInputSchema = z.object({
  count: z.optional(z.number()),
})

const suggestDefinition: AgentDefinition<typeof SuggestInputSchema> = {
  name: 'directions.suggest',
  description: 'Suggest possible story directions based on current context.',
  inputSchema: SuggestInputSchema,
  run: async (ctx, input) => {
    return suggestDirections(ctx.dataDir, ctx.storyId, input)
  },
}

let registered = false

export function registerDirectionsAgents(): void {
  if (registered) return

  agentRegistry.register(suggestDefinition)

  modelRoleRegistry.register({ key: 'directions', label: 'Directions', description: 'Story direction suggestions', fallback: ['generation'] })

  agentBlockRegistry.register({
    agentName: 'directions.suggest',
    displayName: 'Directions',
    description: 'Suggests possible story directions based on current context.',
    createDefaultBlocks: createDirectionsSuggestBlocks,
    availableTools: [],
    buildPreviewContext: buildDirectionsPreviewContext,
  })

  registered = true
}

/** Auto-discovery entry point */
export const register = registerDirectionsAgents
