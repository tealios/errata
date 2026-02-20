import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import { agentBlockRegistry } from '../agents/agent-block-registry'
import { modelRoleRegistry } from '../agents/model-role-registry'
import type { AgentDefinition } from '../agents/types'
import { runLibrarian } from './agent'
import { librarianChat } from './chat'
import { refineFragment } from './refine'
import { transformProseSelection } from './prose-transform'
import {
  createLibrarianAnalyzeBlocks,
  buildAnalyzePreviewContext,
  createLibrarianChatBlocks,
  buildChatPreviewContext,
  createLibrarianRefineBlocks,
  buildRefinePreviewContext,
  createProseTransformBlocks,
  buildProseTransformPreviewContext,
} from './blocks'

const AnalyzeInputSchema = z.object({
  fragmentId: z.string(),
})

const RefineInputSchema = z.object({
  fragmentId: z.string(),
  instructions: z.string().optional(),
  maxSteps: z.int().positive().optional(),
})

const ChatInputSchema = z.object({
  messages: z.array(z.object({
    role: z.union([z.literal('user'), z.literal('assistant')]),
    content: z.string(),
  })),
  maxSteps: z.int().positive().optional(),
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

  // Agent definitions
  agentRegistry.register(analyzeDefinition)
  agentRegistry.register(refineDefinition)
  agentRegistry.register(chatDefinition)
  agentRegistry.register(proseTransformDefinition)

  // Model roles
  modelRoleRegistry.register({ key: 'librarian', label: 'Librarian', description: 'Background analysis and summaries', fallback: ['generation'] })
  modelRoleRegistry.register({ key: 'proseTransform', label: 'Prose Transform', description: 'Rewrite, expand, compress selected text', fallback: ['librarian', 'generation'] })
  modelRoleRegistry.register({ key: 'librarianChat', label: 'Librarian Chat', description: 'Interactive librarian conversation', fallback: ['librarian', 'generation'] })
  modelRoleRegistry.register({ key: 'librarianRefine', label: 'Librarian Refine', description: 'Fragment refinement', fallback: ['librarian', 'generation'] })

  // Block definitions
  agentBlockRegistry.register({
    agentName: 'librarian.analyze',
    displayName: 'Librarian Analyze',
    description: 'Analyzes prose fragments for continuity signals and summary updates.',
    createDefaultBlocks: createLibrarianAnalyzeBlocks,
    availableTools: ['updateSummary', 'reportMentions', 'reportContradictions', 'suggestKnowledge', 'reportTimeline', 'suggestDirections'],
    buildPreviewContext: buildAnalyzePreviewContext,
  })

  agentBlockRegistry.register({
    agentName: 'librarian.chat',
    displayName: 'Librarian Chat',
    description: 'Conversational librarian assistant with write-enabled fragment tools.',
    createDefaultBlocks: createLibrarianChatBlocks,
    availableTools: [
      'getFragment', 'listFragments', 'searchFragments', 'listFragmentTypes',
      'createFragment', 'updateFragment', 'editFragment', 'deleteFragment',
      'editProse', 'getStorySummary', 'updateStorySummary', 'reanalyzeFragment',
    ],
    buildPreviewContext: buildChatPreviewContext,
  })

  agentBlockRegistry.register({
    agentName: 'librarian.refine',
    displayName: 'Librarian Refine',
    description: 'Refines non-prose fragments using story context and fragment tools.',
    createDefaultBlocks: createLibrarianRefineBlocks,
    availableTools: [
      'getFragment', 'listFragments', 'searchFragments', 'listFragmentTypes',
      'createFragment', 'updateFragment', 'editFragment', 'deleteFragment',
      'editProse', 'getStorySummary', 'updateStorySummary',
    ],
    buildPreviewContext: buildRefinePreviewContext,
  })

  agentBlockRegistry.register({
    agentName: 'librarian.prose-transform',
    displayName: 'Prose Transform',
    description: 'Transforms selected prose spans (rewrite, expand, compress, custom).',
    createDefaultBlocks: createProseTransformBlocks,
    availableTools: [],
    buildPreviewContext: buildProseTransformPreviewContext,
  })

  registered = true
}

/** Auto-discovery entry point */
export const register = registerLibrarianAgents
