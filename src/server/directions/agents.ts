import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import { agentBlockRegistry } from '../agents/agent-block-registry'
import { modelRoleRegistry } from '../agents/model-role-registry'
import { instructionRegistry } from '../instructions'
import type { AgentDefinition } from '../agents/types'
import { suggestDirections, DEFAULT_SUGGEST_PROMPT } from './suggest'
import { DIRECTIONS_SYSTEM_PROMPT, createDirectionsSuggestBlocks, buildDirectionsPreviewContext } from './blocks'

const SuggestInputSchema = z.object({
  count: z.optional(z.number()),
})

declare module '../agents/agent-instance' {
  interface AgentInputMap {
    'directions.suggest': z.infer<typeof SuggestInputSchema>
  }
}

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

  // Register instruction defaults
  instructionRegistry.registerDefault('directions.system', DIRECTIONS_SYSTEM_PROMPT.trim())
  instructionRegistry.registerDefault('directions.suggest-template', DEFAULT_SUGGEST_PROMPT)

  agentRegistry.register(suggestDefinition)

  modelRoleRegistry.register({ key: 'directions', label: 'Directions', description: 'Story direction suggestions' })

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
