import { ToolLoopAgent, stepCountIs } from 'ai'
import { getModel } from '../llm/client'
import { getStory, getFragment } from '../fragments/storage'
import { createLogger } from '../logging'
import { withBranch } from '../fragments/branches'

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

export interface ProseTransformResult {
  eventStream: ReadableStream<string>
  completion: Promise<{
    text: string
    reasoning: string
    stepCount: number
    finishReason: string
  }>
}

const OPERATION_GUIDANCE: Record<Exclude<ProseTransformOperation, 'custom'>, string> = {
  rewrite: 'Rewrite the selected span for clarity and flow while preserving the original meaning and voice.',
  expand: 'Expand the selected span with more detail while preserving intent, continuity, and point of view.',
  compress: 'Compress the selected span to a tighter version while preserving essential meaning and continuity.',
}

const PROSE_TRANSFORM_SYSTEM_PROMPT = `You transform selected prose spans for an author in a writing app.

Rules:
- Follow the requested operation exactly.
- Preserve story facts, continuity, tense, and point of view.
- Do not add metadata, explanations, markdown, quotes, or labels.
- Return only the transformed replacement text for the selected span.`

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

  const userPrompt = [
    `Operation: ${opts.operation}`,
    guidance,
    '',
    'Story summary:',
    story.summary || '(none)',
    '',
    'Fragment context:',
    sourceContent,
    '',
    'Selected span to transform:',
    selectedText,
    '',
    'Context before selected span:',
    opts.contextBefore?.trim() || '(none)',
    '',
    'Context after selected span:',
    opts.contextAfter?.trim() || '(none)',
  ].join('\n')

  const { model, modelId } = await getModel(dataDir, storyId, { role: 'proseTransform' })
  requestLogger.info('Resolved model', { modelId })

  const agent = new ToolLoopAgent({
    model,
    instructions: PROSE_TRANSFORM_SYSTEM_PROMPT,
    tools: {},
    toolChoice: 'none',
    stopWhen: stepCountIs(1),
  })

  const result = await agent.stream({
    messages: [{ role: 'user', content: userPrompt }],
  })

  const fullStream = result.fullStream

  let completionResolve: (val: { text: string; reasoning: string; stepCount: number; finishReason: string }) => void
  let completionReject: (err: unknown) => void
  const completion = new Promise<{
    text: string
    reasoning: string
    stepCount: number
    finishReason: string
  }>((resolve, reject) => {
    completionResolve = resolve
    completionReject = reject
  })

  const eventStream = new ReadableStream<string>({
    async start(controller) {
      let fullText = ''
      let fullReasoning = ''
      let stepCount = 0
      let finishReason = 'unknown'

      try {
        for await (const part of fullStream) {
          const p = part as Record<string, unknown>
          let event: Record<string, unknown> | null = null

          switch (part.type) {
            case 'text-delta': {
              const text = String(p.text ?? '')
              fullText += text
              event = { type: 'text', text }
              break
            }
            case 'reasoning-delta': {
              const text = String(p.text ?? '')
              fullReasoning += text
              event = { type: 'reasoning', text }
              break
            }
            case 'finish': {
              finishReason = String(p.finishReason ?? 'unknown')
              stepCount++
              break
            }
          }

          if (event) {
            controller.enqueue(JSON.stringify(event) + '\n')
          }
        }

        controller.enqueue(JSON.stringify({ type: 'finish', finishReason, stepCount }) + '\n')
        controller.close()

        requestLogger.info('Prose transform completed', {
          stepCount,
          finishReason,
          outputLength: fullText.trim().length,
          reasoningLength: fullReasoning.trim().length,
        })

        completionResolve({
          text: fullText,
          reasoning: fullReasoning,
          stepCount,
          finishReason,
        })
      } catch (err) {
        controller.error(err)
        completionReject(err)
      }
    },
  })

  return {
    eventStream,
    completion,
  }
}
