import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import { agentBlockRegistry } from '../agents/agent-block-registry'
import { modelRoleRegistry } from '../agents/model-role-registry'
import { instructionRegistry } from '../instructions'
import type { AgentDefinition } from '../agents/types'
import { runLibrarian } from './agent'
import { librarianChat } from './chat'
import { refineFragment } from './refine'
import { transformProseSelection } from './prose-transform'
import {
  ANALYZE_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  REFINE_SYSTEM_PROMPT,
  PROSE_TRANSFORM_SYSTEM_PROMPT,
  createLibrarianAnalyzeBlocks,
  buildAnalyzePreviewContext,
  createLibrarianChatBlocks,
  buildChatPreviewContext,
  createLibrarianRefineBlocks,
  buildRefinePreviewContext,
  createProseTransformBlocks,
  buildProseTransformPreviewContext,
} from './blocks'
import { SUMMARY_COMPACTION_PROMPT } from './agent'

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

  // Register instruction defaults
  instructionRegistry.registerDefault('librarian.analyze.system', ANALYZE_SYSTEM_PROMPT.trim())
  instructionRegistry.registerDefault('librarian.chat.system', CHAT_SYSTEM_PROMPT.trim())
  instructionRegistry.registerDefault('librarian.refine.system', REFINE_SYSTEM_PROMPT)
  instructionRegistry.registerDefault('librarian.prose-transform.system', PROSE_TRANSFORM_SYSTEM_PROMPT)
  instructionRegistry.registerDefault('librarian.summary-compaction', SUMMARY_COMPACTION_PROMPT)

  // Agent definitions
  agentRegistry.register(analyzeDefinition)
  agentRegistry.register(refineDefinition)
  agentRegistry.register(chatDefinition)
  agentRegistry.register(proseTransformDefinition)

  // Model role (namespace-level only — per-agent resolution via dot-separated names)
  modelRoleRegistry.register({ key: 'librarian', label: 'Librarian', description: 'Background analysis and summaries' })

  // Block definitions
  agentBlockRegistry.register({
    agentName: 'librarian.analyze',
    displayName: 'Librarian Analyze',
    description: 'Analyzes prose fragments for continuity signals and summary updates.',
    createDefaultBlocks: createLibrarianAnalyzeBlocks,
    availableTools: ['updateSummary', 'reportMentions', 'reportContradictions', 'suggestFragment', 'updateFragment', 'reportTimeline', 'suggestDirections'],
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
