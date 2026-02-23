import { tool } from 'ai'
import { z } from 'zod/v4'
import { getModel } from '../llm/client'
import { getFragment, getStory } from '../fragments/storage'
import { buildContextState } from '../llm/context-builder'
import { createFragmentTools } from '../llm/tools'
import { pluginRegistry } from '../plugins/registry'
import { collectPluginTools } from '../plugins/tools'
import { createLogger } from '../logging'
import { createToolAgent } from '../agents/create-agent'
import { createEventStream } from '../agents/create-event-stream'
import { compileAgentContext } from '../agents/compile-agent-context'
import { createAgentInstance } from '../agents/agent-instance'
import { getFragmentsByTag } from '../fragments/associations'
import { runLibrarian } from './agent'
import { withBranch } from '../fragments/branches'
import type { ChatStreamEvent, ChatResult } from '../agents/stream-types'
import type { AgentBlockContext } from '../agents/agent-block-context'

export type { ChatStreamEvent, ChatResult }

const logger = createLogger('librarian-chat')

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  maxSteps?: number
}

export async function librarianChat(
  dataDir: string,
  storyId: string,
  opts: ChatOptions,
): Promise<ChatResult> {
  return withBranch(dataDir, storyId, () => librarianChatInner(dataDir, storyId, opts))
}

async function librarianChatInner(
  dataDir: string,
  storyId: string,
  opts: ChatOptions,
): Promise<ChatResult> {
  const requestLogger = logger.child({ storyId })
  requestLogger.info('Starting librarian chat...', { messageCount: opts.messages.length })

  // Validate story exists
  const story = await getStory(dataDir, storyId)
  if (!story) {
    throw new Error(`Story ${storyId} not found`)
  }

  // Build context
  const ctxState = await buildContextState(dataDir, storyId, '')

  // Load system prompt fragments
  const sysFragIds = await getFragmentsByTag(dataDir, storyId, 'pass-to-librarian-system-prompt')
  const systemPromptFragments = []
  for (const id of sysFragIds) {
    const frag = await getFragment(dataDir, storyId, id)
    if (frag) {
      requestLogger.debug('Adding system prompt fragment to context', { fragmentId: frag.id, name: frag.name })
      systemPromptFragments.push(frag)
    }
  }

  // Resolve model early so modelId is available for instruction resolution
  const { model, modelId } = await getModel(dataDir, storyId, { role: 'librarian.chat' })
  requestLogger.info('Resolved model', { modelId })

  // Create write-enabled fragment tools + enabled plugin tools
  const enabledPlugins = (story.settings.enabledPlugins ?? [])
    .map((name) => pluginRegistry.get(name))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
  const fragmentTools = createFragmentTools(dataDir, storyId, { readOnly: false })
  const pluginTools = collectPluginTools(enabledPlugins, dataDir, storyId)

  const reanalyzeFragmentTool = tool({
    description: 'Re-run librarian analysis on a prose fragment. Updates its summary, detects mentions, flags contradictions, and suggests knowledge.',
    inputSchema: z.object({
      fragmentId: z.string().describe('The prose fragment ID to reanalyze (e.g. pr-bakumo)'),
    }),
    execute: async ({ fragmentId }: { fragmentId: string }) => {
      requestLogger.info('Reanalyzing fragment via chat tool', { fragmentId })
      try {
        const analysis = await runLibrarian(dataDir, storyId, fragmentId)
        return {
          ok: true,
          analysisId: analysis.id,
          summary: analysis.summaryUpdate,
          mentionCount: analysis.mentionedCharacters.length,
          contradictionCount: analysis.contradictions.length,
          suggestionCount: analysis.fragmentSuggestions.length,
          timelineEventCount: analysis.timelineEvents.length,
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const optimizeCharacterTool = tool({
    description: 'Optimize a character sheet using depth-focused writing methodology. Rewrites the character with causality, Egri dimensions, friction, and contrast.',
    inputSchema: z.object({
      fragmentId: z.string().describe('The character fragment ID to optimize (e.g. ch-bakumo)'),
      instructions: z.string().optional().describe('Optional specific instructions for the optimization'),
    }),
    execute: async ({ fragmentId, instructions }: { fragmentId: string; instructions?: string }) => {
      requestLogger.info('Optimizing character via chat tool', { fragmentId })
      const agent = createAgentInstance('librarian.optimize-character', { dataDir, storyId })
      try {
        const result = await agent.execute({ fragmentId, instructions })
        await result.completion
        return { ok: true, fragmentId }
      } catch (err) {
        agent.fail(err)
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const allTools = { ...fragmentTools, ...pluginTools, reanalyzeFragment: reanalyzeFragmentTool, optimizeCharacter: optimizeCharacterTool }

  // Build plugin tool descriptions for the block context
  const pluginToolDescriptions = Object.entries(pluginTools).map(([name, def]) => ({
    name,
    description: (def as { description?: string }).description ?? '',
  }))

  // Build agent block context
  const blockContext: AgentBlockContext = {
    story: ctxState.story,
    proseFragments: ctxState.proseFragments,
    stickyGuidelines: ctxState.stickyGuidelines,
    stickyKnowledge: ctxState.stickyKnowledge,
    stickyCharacters: ctxState.stickyCharacters,
    guidelineShortlist: ctxState.guidelineShortlist,
    knowledgeShortlist: ctxState.knowledgeShortlist,
    characterShortlist: ctxState.characterShortlist,
    systemPromptFragments,
    pluginToolDescriptions,
    modelId,
  }

  // Compile context via block system
  const compiled = await compileAgentContext(dataDir, storyId, 'librarian.chat', blockContext, allTools)

  requestLogger.info('Prepared chat tools', {
    fragmentToolCount: Object.keys(fragmentTools).length,
    pluginToolCount: Object.keys(pluginTools).length,
    totalToolCount: Object.keys(compiled.tools).length,
  })

  // Extract system instructions from compiled messages
  const systemMessage = compiled.messages.find(m => m.role === 'system')
  const userMessage = compiled.messages.find(m => m.role === 'user')

  const chatAgent = createToolAgent({
    model,
    instructions: systemMessage?.content || 'You are a helpful assistant.',
    tools: compiled.tools,
    maxSteps: opts.maxSteps ?? 10,
  })

  // Build messages: context as first user message, then conversation history
  const aiMessages = [
    { role: 'user' as const, content: `Here is the current story context for reference:\n\n${userMessage?.content ?? ''}\n\nI'm ready to chat about this story. Please acknowledge briefly.` },
    { role: 'assistant' as const, content: 'I have the story context. How can I help you with your fragments?' },
    ...opts.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  // Stream with write tools
  const result = await chatAgent.stream({
    messages: aiMessages,
  })

  return createEventStream(result.fullStream)
}
