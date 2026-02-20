import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import type { AgentDefinition } from '../agents/types'
import { summarizeChapter } from './summarize'
import { withBranch } from '../fragments/branches'

const SummarizeInputSchema = z.object({
  fragmentId: z.string(),
})

const summarizeDefinition: AgentDefinition<typeof SummarizeInputSchema> = {
  name: 'chapters.summarize',
  description: 'Summarize a chapter by collecting prose from marker to next marker and generating a summary.',
  inputSchema: SummarizeInputSchema,
  run: async (ctx, input) => {
    return withBranch(ctx.dataDir, ctx.storyId, async () => {
      return summarizeChapter(ctx.dataDir, ctx.storyId, input)
    })
  },
}

let registered = false

export function registerChapterAgents(): void {
  if (registered) return
  agentRegistry.register(summarizeDefinition)
  registered = true
}

/** Auto-discovery entry point */
export const register = registerChapterAgents
