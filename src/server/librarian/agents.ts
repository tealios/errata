import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import type { AgentDefinition } from '../agents/types'
import { runLibrarian } from './agent'
import { librarianChat } from './chat'
import { refineFragment } from './refine'

const AnalyzeInputSchema = z.object({
  fragmentId: z.string(),
})

const RefineInputSchema = z.object({
  fragmentId: z.string(),
  instructions: z.string().optional(),
  maxSteps: z.number().int().positive().optional(),
})

const ChatInputSchema = z.object({
  messages: z.array(z.object({
    role: z.union([z.literal('user'), z.literal('assistant')]),
    content: z.string(),
  })),
  maxSteps: z.number().int().positive().optional(),
})

const analyzeDefinition: AgentDefinition<typeof AnalyzeInputSchema> = {
  name: 'librarian.analyze',
  description: 'Analyze a prose fragment for continuity signals and summary updates.',
  inputSchema: AnalyzeInputSchema,
  run: async (ctx, input) => {
    return runLibrarian(ctx.dataDir, ctx.storyId, input.fragmentId)
  },
}

const refineDefinition: AgentDefinition<typeof RefineInputSchema> = {
  name: 'librarian.refine',
  description: 'Refine a non-prose fragment using story context and fragment tools.',
  inputSchema: RefineInputSchema,
  allowedCalls: ['librarian.analyze'],
  run: async (ctx, input) => {
    return refineFragment(ctx.dataDir, ctx.storyId, input)
  },
}

const chatDefinition: AgentDefinition<typeof ChatInputSchema> = {
  name: 'librarian.chat',
  description: 'Run conversational librarian assistant with write-enabled tools.',
  inputSchema: ChatInputSchema,
  allowedCalls: ['librarian.refine', 'librarian.analyze'],
  run: async (ctx, input) => {
    return librarianChat(ctx.dataDir, ctx.storyId, input)
  },
}

let registered = false

export function registerLibrarianAgents(): void {
  if (registered) return
  agentRegistry.register(analyzeDefinition)
  agentRegistry.register(refineDefinition)
  agentRegistry.register(chatDefinition)
  registered = true
}
