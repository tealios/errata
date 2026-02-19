import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import type { AgentDefinition } from '../agents/types'
import { runLibrarian } from './agent'
import { librarianChat } from './chat'
import { refineFragment } from './refine'
import { transformProseSelection } from './prose-transform'

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

const ProseTransformInputSchema = z.object({
  fragmentId: z.string(),
  selectedText: z.string().min(1),
  operation: z.union([z.literal('rewrite'), z.literal('expand'), z.literal('compress'), z.literal('custom')]),
  instruction: z.string().optional(),
  sourceContent: z.string().optional(),
  contextBefore: z.string().optional(),
  contextAfter: z.string().optional(),
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

const proseTransformDefinition: AgentDefinition<typeof ProseTransformInputSchema> = {
  name: 'librarian.prose-transform',
  description: 'Transform a selected prose span using librarian model guidance.',
  inputSchema: ProseTransformInputSchema,
  run: async (ctx, input) => {
    return transformProseSelection(ctx.dataDir, ctx.storyId, input)
  },
}

let registered = false

export function registerLibrarianAgents(): void {
  if (registered) return
  agentRegistry.register(analyzeDefinition)
  agentRegistry.register(refineDefinition)
  agentRegistry.register(chatDefinition)
  agentRegistry.register(proseTransformDefinition)
  registered = true
}
