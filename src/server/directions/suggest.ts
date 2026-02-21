import { ToolLoopAgent, stepCountIs } from 'ai'
import { getModel } from '../llm/client'
import { getStory, getFragment, listFragments } from '../fragments/storage'
import { buildContextState, createDefaultBlocks, compileBlocks } from '../llm/context-builder'
import { getBlockConfig } from '../blocks/storage'
import { applyBlockConfig } from '../blocks/apply'
import { createLogger } from '../logging'

const logger = createLogger('directions-suggest')

const DEFAULT_SUGGEST_PROMPT = `Based on everything in the story so far, suggest exactly {{count}} possible directions the story could go next. Return ONLY a JSON array with no other text. Each element must have:
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
  const promptTemplate = story?.settings.guidedSuggestPrompt || DEFAULT_SUGGEST_PROMPT
  const prompt = promptTemplate.replace(/\{\{count\}\}/g, String(count))

  // Build full story context using the block system
  const ctxState = await buildContextState(dataDir, storyId, '')
  let blocks = createDefaultBlocks(ctxState)
  const blockConfig = await getBlockConfig(dataDir, storyId)
  blocks = await applyBlockConfig(blocks, blockConfig, {
    ...ctxState,
    getFragment: (id: string) => getFragment(dataDir, storyId, id),
    getFragments: (type?: string) => listFragments(dataDir, storyId, type),
  })
  const messages = compileBlocks(blocks)

  const { model, modelId } = await getModel(dataDir, storyId, { role: 'directions' })
  requestLogger.info('Generating suggestions', { modelId, count })

  const agent = new ToolLoopAgent({
    model,
    instructions: '',
    tools: {},
    toolChoice: 'none' as const,
    stopWhen: stepCountIs(1),
  })

  const startTime = Date.now()
  let fullText = ''

  const result = await agent.stream({
    messages: [
      ...messages,
      { role: 'user' as const, content: prompt },
    ],
  })

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      fullText += (part as Record<string, unknown>).text ?? ''
    }
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
