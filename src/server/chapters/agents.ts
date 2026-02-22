import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import { instructionRegistry } from '../instructions'
import type { AgentDefinition } from '../agents/types'
import { summarizeChapter, CHAPTER_SUMMARIZE_SYSTEM_PROMPT } from './summarize'
import { withBranch } from '../fragments/branches'

const SummarizeInputSchema = z.object({
  fragmentId: z.string(),
})

declare module '../agents/agent-instance' {
  interface AgentInputMap {
    'chapters.summarize': z.infer<typeof SummarizeInputSchema>
  }
}

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
  instructionRegistry.registerDefault('chapters.summarize.system', CHAPTER_SUMMARIZE_SYSTEM_PROMPT)
  agentRegistry.register(summarizeDefinition)
  registered = true
}

/** Auto-discovery entry point */
export const register = registerChapterAgents
