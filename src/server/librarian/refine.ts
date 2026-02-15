import { streamText, stepCountIs } from 'ai'
import { getModel } from '../llm/client'
import { getStory, getFragment } from '../fragments/storage'
import { buildContextState } from '../llm/context-builder'
import { createFragmentTools } from '../llm/tools'
import { createLogger } from '../logging'

const logger = createLogger('librarian-refine')

const REFINE_SYSTEM_PROMPT = `You are a fragment refinement agent for a collaborative writing app. Your job is to improve a specific fragment (character, guideline, or knowledge) based on the story context.

Instructions:
1. First, read the target fragment using the appropriate get tool (e.g. getCharacter, getKnowledge, getGuideline).
2. Analyze the story context provided: prose, summary, and other fragments.
3. Use the updateFragment or editFragment tool to improve the target fragment.
4. Explain what you changed and why in your text response.

Guidelines for refinement:
- If the user provides specific instructions, follow them precisely.
- If no instructions are given, improve the fragment for consistency, clarity, and depth based on story events.
- Preserve the fragment's existing voice and style unless asked otherwise.
- Update descriptions to stay within the 50 character limit.
- Do NOT delete fragments unless explicitly asked.
- Do NOT modify prose fragments — only characters, guidelines, and knowledge.`

export interface RefineOptions {
  fragmentId: string
  instructions?: string
  maxSteps?: number
}

export interface RefineResult {
  textStream: ReadableStream<string>
  completion: Promise<{
    text: string
    toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>
    stepCount: number
    finishReason: string
  }>
}

export async function refineFragment(
  dataDir: string,
  storyId: string,
  opts: RefineOptions,
): Promise<RefineResult> {
  const requestLogger = logger.child({ storyId, fragmentId: opts.fragmentId })
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

  // Build context (exclude target fragment to avoid duplication — LLM reads it via tool)
  const ctxState = await buildContextState(dataDir, storyId, '', {
    excludeFragmentId: opts.fragmentId,
  })

  // Build a simplified context message for refinement (not prose generation)
  const contextParts: string[] = []

  contextParts.push(`## Story: ${story.name}`)
  contextParts.push(story.description)
  if (story.summary) {
    contextParts.push(`\n## Story Summary\n${story.summary}`)
  }

  // Include recent prose for context
  if (ctxState.proseFragments.length > 0) {
    contextParts.push('\n## Recent Prose')
    for (const p of ctxState.proseFragments) {
      contextParts.push(`### ${p.name} (${p.id})`)
      contextParts.push(p.content)
    }
  }

  // Include sticky fragments for reference
  const stickyAll = [
    ...ctxState.stickyGuidelines,
    ...ctxState.stickyKnowledge,
    ...ctxState.stickyCharacters,
  ]
  if (stickyAll.length > 0) {
    contextParts.push('\n## Active Context Fragments')
    for (const f of stickyAll) {
      contextParts.push(`- ${f.id}: ${f.name} — ${f.description}`)
    }
  }

  // Build user message with target info and instructions
  const userParts: string[] = []
  userParts.push(`Target fragment to refine: ${opts.fragmentId} (type: ${fragment.type}, name: "${fragment.name}")`)
  if (opts.instructions) {
    userParts.push(`\nUser instructions: ${opts.instructions}`)
  } else {
    userParts.push('\nNo specific instructions provided. Improve this fragment based on recent story events for consistency, clarity, and depth.')
  }

  // Create write-enabled fragment tools
  const tools = createFragmentTools(dataDir, storyId, { readOnly: false })

  // Resolve model
  const { model, modelId } = await getModel(dataDir, storyId)
  requestLogger.info('Resolved model', { modelId })

  // Stream with write tools
  const result = streamText({
    model,
    system: REFINE_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: contextParts.join('\n') + '\n\n' + userParts.join('\n') },
    ],
    tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(opts.maxSteps ?? 5),
  })

  // Tee the text stream
  const textStream = result.textStream
  const [clientStream, collectStream] = textStream.tee()

  // Build completion promise
  const completion = (async () => {
    // Collect full text
    let fullText = ''
    const reader = collectStream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += value
    }

    // Collect tool calls from steps
    const toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }> = []
    const steps = await result.steps
    for (const step of steps) {
      if (step.toolCalls) {
        for (const tc of step.toolCalls) {
          const call = tc as { toolName: string; args?: Record<string, unknown>; result?: unknown }
          toolCalls.push({
            toolName: call.toolName,
            args: call.args ?? {},
            result: call.result ?? null,
          })
        }
      }
    }

    const finishReason = await result.finishReason ?? 'unknown'
    const stepCount = steps.length

    requestLogger.info('Refinement completed', { stepCount, finishReason: String(finishReason), toolCallCount: toolCalls.length })

    return {
      text: fullText,
      toolCalls,
      stepCount,
      finishReason: String(finishReason),
    }
  })()

  return {
    textStream: clientStream,
    completion,
  }
}
