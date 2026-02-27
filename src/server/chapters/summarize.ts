import { ToolLoopAgent, stepCountIs } from 'ai'
import { getModel } from '../llm/client'
import { getFragment, updateFragment } from '../fragments/storage'
import { getFullProseChain } from '../fragments/prose-chain'
import { instructionRegistry } from '../instructions'
import { createLogger } from '../logging'

const logger = createLogger('chapter-summarize')

export const CHAPTER_SUMMARIZE_SYSTEM_PROMPT = `You are a story summarizer for a collaborative writing app.
Given prose content from a chapter, write a concise 2 paragraph summary capturing the key events, character actions, and mood.
Respond with only the summary text.`

export interface ChapterSummarizeInput {
  fragmentId: string
}

export interface StreamEvent {
  type: string
  [key: string]: unknown
}

export interface ChapterSummarizeResult {
  summary: string
  reasoning: string
  modelId: string
  durationMs: number
  trace: StreamEvent[]
}

export async function summarizeChapter(
  dataDir: string,
  storyId: string,
  input: ChapterSummarizeInput,
): Promise<ChapterSummarizeResult> {
  const requestLogger = logger.child({ storyId })

  const marker = await getFragment(dataDir, storyId, input.fragmentId)
  if (!marker || marker.type !== 'marker') {
    throw new Error('Chapter marker not found')
  }

  const chain = await getFullProseChain(dataDir, storyId)
  if (!chain) {
    throw new Error('No prose chain found')
  }

  const markerIndex = chain.entries.findIndex(e => e.active === input.fragmentId)
  if (markerIndex === -1) {
    throw new Error('Marker not found in prose chain')
  }

  // Collect prose content from marker to next marker/end
  const proseContent: string[] = []
  for (let i = markerIndex + 1; i < chain.entries.length; i++) {
    const entry = chain.entries[i]
    const fragment = await getFragment(dataDir, storyId, entry.active)
    if (!fragment) continue
    if (fragment.type === 'marker') break
    proseContent.push(fragment.content)
  }

  if (proseContent.length === 0) {
    throw new Error('No prose content in this chapter to summarize')
  }

  requestLogger.info('Summarizing chapter...', {
    fragmentId: input.fragmentId,
    proseFragments: proseContent.length,
  })

  const { model, modelId, temperature } = await getModel(dataDir, storyId, { role: 'librarian' })
  requestLogger.info('Resolved model', { modelId })

  const agent = new ToolLoopAgent({
    model,
    instructions: instructionRegistry.resolve('chapters.summarize.system', modelId),
    tools: {},
    toolChoice: 'none' as const,
    stopWhen: stepCountIs(1),
    temperature,
  })

  const startTime = Date.now()
  let fullText = ''
  let fullReasoning = ''
  let stepCount = 0
  let lastFinishReason = 'unknown'
  const trace: StreamEvent[] = []

  const result = await agent.stream({
    prompt: `Summarize this chapter:\n\n${proseContent.join('\n\n')}`,
  })

  for await (const part of result.fullStream) {
    const p = part as Record<string, unknown>

    switch (part.type) {
      case 'text-delta': {
        const text = (p.text ?? '') as string
        fullText += text
        trace.push({ type: 'text-delta', text })
        break
      }
      case 'reasoning-delta': {
        const text = (p.text ?? '') as string
        fullReasoning += text
        trace.push({ type: 'reasoning-delta', text })
        break
      }
      case 'finish':
        lastFinishReason = (p.finishReason as string) ?? 'unknown'
        stepCount++
        trace.push({ type: 'finish', finishReason: lastFinishReason, stepCount })
        break
    }
  }

  const durationMs = Date.now() - startTime
  const summary = fullText.trim()

  requestLogger.info('Summary generated', {
    summaryLength: summary.length,
    reasoningLength: fullReasoning.length,
    modelId,
    durationMs,
    stepCount,
    finishReason: lastFinishReason,
  })

  let old = await getFragment(dataDir, storyId, input.fragmentId)
  if (!old) {
    requestLogger.error('Marker fragment disappeared during summarization')
    return {
      summary,
      reasoning: fullReasoning,
      modelId,
      durationMs,
      trace,
    }
  }

  requestLogger.info('Saving summary to marker content', { fragmentId: input.fragmentId,
    dataDir, storyId,
    summaryLength: summary.length })
  // Save as marker content
  await updateFragment(dataDir, storyId, {
    ...old,
    name: marker.name,
    description: marker.description,
    content: summary,
  })

  return {
    summary,
    reasoning: fullReasoning,
    modelId,
    durationMs,
    trace,
  }
}
