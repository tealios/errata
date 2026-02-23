import { ToolLoopAgent, stepCountIs } from 'ai'
import { getModel } from '../llm/client'
import { getStory, getFragment } from '../fragments/storage'
import { buildContextState, compileBlocks } from '../llm/context-builder'
import { compileAgentContext } from '../agents/compile-agent-context'
import { getFragmentsByTag } from '../fragments/associations'
import { instructionRegistry } from '../instructions'
import { reportUsage } from '../llm/token-tracker'
import { createLogger } from '../logging'
import type { AgentBlockContext } from '../agents/agent-block-context'

const logger = createLogger('directions-suggest')

export const DEFAULT_SUGGEST_PROMPT = `Based on everything in the story so far, suggest exactly {{count}} possible directions the story could go next. Return ONLY a JSON array with no other text. Each element must have:
- "title": a short evocative title (3-6 words)
- "description": 1-2 sentences describing this direction
- "instruction": a detailed writing prompt (2-3 sentences) that could be given to a writer to produce this continuation

Consider a mix of: advancing the main plot, exploring character relationships, introducing tension or conflict, quiet character moments, and unexpected developments. Make each suggestion meaningfully different from the others.

Respond with ONLY the JSON array, no markdown fences or other text.`

export interface SuggestDirectionsInput {
  count?: number
}

export interface SuggestionDirection {
  title: string
  description: string
  instruction: string
}

export interface SuggestDirectionsResult {
  suggestions: SuggestionDirection[]
  modelId: string
  durationMs: number
}

export async function suggestDirections(
  dataDir: string,
  storyId: string,
  input: SuggestDirectionsInput,
): Promise<SuggestDirectionsResult> {
  const requestLogger = logger.child({ storyId })
  const count = input.count ?? 4

  // Load story to get custom prompt if configured
  const story = await getStory(dataDir, storyId)

  const { model, modelId } = await getModel(dataDir, storyId, { role: 'directions.suggest' })

  const resolvedTemplate = instructionRegistry.resolve('directions.suggest-template', modelId)
  const promptTemplate = story?.settings.guidedSuggestPrompt || resolvedTemplate
  const prompt = promptTemplate.replace(/\{\{count\}\}/g, String(count))

  // Build context through the directions agent block system
  const ctxState = await buildContextState(dataDir, storyId, '')

  const sysFragIds = await getFragmentsByTag(dataDir, storyId, 'pass-to-librarian-system-prompt')
  const systemPromptFragments = []
  for (const id of sysFragIds) {
    const frag = await getFragment(dataDir, storyId, id)
    if (frag) systemPromptFragments.push(frag)
  }

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
    modelId,
  }

  const compiled = await compileAgentContext(dataDir, storyId, 'directions.suggest', blockContext, {})
  const systemMsg = compiled.messages.find(m => m.role === 'system')
  const userMessages = compiled.messages.filter(m => m.role !== 'system')

  requestLogger.info('Generating suggestions', { modelId, count })

  const agent = new ToolLoopAgent({
    model,
    instructions: systemMsg?.content || instructionRegistry.resolve('directions.system', modelId),
    tools: {},
    toolChoice: 'none' as const,
    stopWhen: stepCountIs(1),
  })

  const startTime = Date.now()
  let fullText = ''

  const result = await agent.stream({
    messages: [
      ...userMessages,
      { role: 'user' as const, content: prompt },
    ],
  })

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      fullText += (part as Record<string, unknown>).text ?? ''
    }
  }

  // Track token usage
  try {
    const rawUsage = await result.totalUsage
    if (rawUsage && typeof rawUsage.inputTokens === 'number') {
      reportUsage(dataDir, storyId, 'directions.suggest', {
        inputTokens: rawUsage.inputTokens,
        outputTokens: rawUsage.outputTokens ?? 0,
      }, modelId)
    }
  } catch {
    // Some providers may not report usage
  }

  const durationMs = Date.now() - startTime

  // Parse the JSON array from the response
  const text = fullText.trim()
  const jsonStr = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  const suggestions = JSON.parse(jsonStr)
  if (!Array.isArray(suggestions)) {
    throw new Error('Model response is not a JSON array')
  }

  requestLogger.info('Suggestions generated', { count: suggestions.length, durationMs })

  return { suggestions, modelId, durationMs }
}
