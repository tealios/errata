import { getModel } from '../llm/client'
import { getStory, getFragment } from '../fragments/storage'
import { buildContextState } from '../llm/context-builder'
import { createFragmentTools } from '../llm/tools'
import { createLogger } from '../logging'
import { createToolAgent } from '../agents/create-agent'
import { createEventStream } from '../agents/create-event-stream'
import { compileAgentContext } from '../agents/compile-agent-context'
import { withBranch } from '../fragments/branches'
import type { AgentStreamResult } from '../agents/stream-types'
import type { AgentBlockContext } from '../agents/agent-block-context'

const logger = createLogger('librarian-refine')

export interface RefineOptions {
  fragmentId: string
  instructions?: string
  maxSteps?: number
}

export type RefineResult = AgentStreamResult

export async function refineFragment(
  dataDir: string,
  storyId: string,
  opts: RefineOptions,
): Promise<RefineResult> {
  return withBranch(dataDir, storyId, () => refineFragmentInner(dataDir, storyId, opts))
}

async function refineFragmentInner(
  dataDir: string,
  storyId: string,
  opts: RefineOptions,
): Promise<RefineResult> {
  const requestLogger = logger.child({ storyId, extra: { fragmentId: opts.fragmentId } })
  requestLogger.info('Starting fragment refinement...')

  // Validate story exists
  const story = await getStory(dataDir, storyId)
  if (!story) {
    throw new Error(`Story ${storyId} not found`)
  }

  // Validate fragment exists
  const fragment = await getFragment(dataDir, storyId, opts.fragmentId)
  if (!fragment) {
    throw new Error(`Fragment ${opts.fragmentId} not found`)
  }

  // Resolve model early so modelId is available for instruction resolution
  const { model, modelId } = await getModel(dataDir, storyId, { role: 'librarian.refine' })
  requestLogger.info('Resolved model', { modelId })

  // Build context (exclude target fragment to avoid duplication — LLM reads it via tool)
  const ctxState = await buildContextState(dataDir, storyId, '', {
    excludeFragmentId: opts.fragmentId,
  })

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
    systemPromptFragments: [],
    targetFragment: fragment,
    instructions: opts.instructions,
    modelId,
  }

  // Create write-enabled fragment tools
  const allTools = createFragmentTools(dataDir, storyId, { readOnly: false })

  // Compile context via block system
  const compiled = await compileAgentContext(dataDir, storyId, 'librarian.refine', blockContext, allTools)

  // Extract system instructions from compiled messages
  const systemMessage = compiled.messages.find(m => m.role === 'system')
  const userMessage = compiled.messages.find(m => m.role === 'user')

  const refineAgent = createToolAgent({
    model,
    instructions: systemMessage?.content ?? '',
    tools: compiled.tools,
    maxSteps: opts.maxSteps ?? 5,
  })

  // Stream with write tools
  const result = await refineAgent.stream({
    messages: userMessage ? [{ role: 'user' as const, content: userMessage.content }] : [],
  })

  return createEventStream(result.fullStream)
}
