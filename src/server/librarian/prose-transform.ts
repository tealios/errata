import { getModel } from '../llm/client'
import { getStory, getFragment } from '../fragments/storage'
import { createLogger } from '../logging'
import { createToolAgent } from '../agents/create-agent'
import { createEventStream } from '../agents/create-event-stream'
import { compileAgentContext } from '../agents/compile-agent-context'
import { withBranch } from '../fragments/branches'
import type { AgentStreamResult } from '../agents/stream-types'
import type { AgentBlockContext } from '../agents/agent-block-context'

const logger = createLogger('librarian-prose-transform')

export type ProseTransformOperation = 'rewrite' | 'expand' | 'compress' | 'custom'

export interface ProseTransformOptions {
  fragmentId: string
  selectedText: string
  operation: ProseTransformOperation
  instruction?: string
  sourceContent?: string
  contextBefore?: string
  contextAfter?: string
}

export type ProseTransformResult = AgentStreamResult

const OPERATION_GUIDANCE: Record<Exclude<ProseTransformOperation, 'custom'>, string> = {
  rewrite: 'Rewrite the selected span for clarity and flow while preserving the original meaning and voice.',
  expand: 'Expand the selected span with more detail while preserving intent, continuity, and point of view.',
  compress: 'Compress the selected span to a tighter version while preserving essential meaning and continuity.',
}

export async function transformProseSelection(
  dataDir: string,
  storyId: string,
  opts: ProseTransformOptions,
): Promise<ProseTransformResult> {
  return withBranch(dataDir, storyId, () => transformProseSelectionInner(dataDir, storyId, opts))
}

async function transformProseSelectionInner(
  dataDir: string,
  storyId: string,
  opts: ProseTransformOptions,
): Promise<ProseTransformResult> {
  const requestLogger = logger.child({ storyId, extra: { fragmentId: opts.fragmentId, operation: opts.operation } })
  requestLogger.info('Starting prose transform')

  const story = await getStory(dataDir, storyId)
  if (!story) throw new Error(`Story ${storyId} not found`)

  const fragment = await getFragment(dataDir, storyId, opts.fragmentId)
  if (!fragment) throw new Error(`Fragment ${opts.fragmentId} not found`)
  if (fragment.type !== 'prose') throw new Error(`Fragment ${opts.fragmentId} is not prose`)

  const sourceContent = (opts.sourceContent ?? fragment.content).trim()
  const selectedText = opts.selectedText.trim()
  if (!selectedText) throw new Error('Selected text is required')

  const guidance = opts.operation === 'custom'
    ? (opts.instruction || 'Improve the selected text.')
    : OPERATION_GUIDANCE[opts.operation]

  // Resolve model early so modelId is available for instruction resolution
  const { model, modelId } = await getModel(dataDir, storyId, { role: 'librarian.prose-transform' })
  requestLogger.info('Resolved model', { modelId })

  // Build agent block context
  const blockContext: AgentBlockContext = {
    story,
    proseFragments: [],
    stickyGuidelines: [],
    stickyKnowledge: [],
    stickyCharacters: [],
    guidelineShortlist: [],
    knowledgeShortlist: [],
    characterShortlist: [],
    systemPromptFragments: [],
    operation: opts.operation,
    guidance,
    selectedText,
    sourceContent,
    contextBefore: opts.contextBefore,
    contextAfter: opts.contextAfter,
    modelId,
  }

  // Compile context via block system
  const compiled = await compileAgentContext(dataDir, storyId, 'librarian.prose-transform', blockContext, {})

  // Extract system instructions from compiled messages
  const systemMessage = compiled.messages.find(m => m.role === 'system')
  const userMessage = compiled.messages.find(m => m.role === 'user')

  const agent = createToolAgent({
    model,
    instructions: systemMessage?.content ?? '',
    tools: compiled.tools,
    maxSteps: 1,
    toolChoice: 'none',
  })

  const result = await agent.stream({
    messages: userMessage ? [{ role: 'user' as const, content: userMessage.content }] : [],
  })

  const streamResult = createEventStream(result.fullStream)

  // Log completion in background
  streamResult.completion.then((c) => {
    requestLogger.info('Prose transform completed', {
      stepCount: c.stepCount,
      finishReason: c.finishReason,
      outputLength: c.text.trim().length,
      reasoningLength: c.reasoning.trim().length,
    })
  }).catch(() => {})

  return streamResult
}
