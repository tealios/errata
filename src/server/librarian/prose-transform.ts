import { getFragment } from '../fragments/storage'
import { createStreamingRunner } from '../agents/create-streaming-runner'
import { createLogger } from '../logging'
import type { AgentStreamResult } from '../agents/stream-types'

const transformLogger = createLogger('librarian-prose-transform')

export type ProseTransformOperation = 'rewrite' | 'expand' | 'compress' | 'custom'

export interface ProseTransformOptions {
  fragmentId: string
  selectedText: string
  operation: ProseTransformOperation
  instruction?: string
  sourceContent?: string
  contextBefore?: string
  contextAfter?: string
  maxSteps?: number
}

export type ProseTransformResult = AgentStreamResult

const OPERATION_GUIDANCE: Record<Exclude<ProseTransformOperation, 'custom'>, string> = {
  rewrite: 'Rewrite the selected span for clarity and flow while preserving the original meaning and voice.',
  expand: 'Expand the selected span with more detail while preserving intent, continuity, and point of view.',
  compress: 'Compress the selected span to a tighter version while preserving essential meaning and continuity.',
}

export const transformProseSelection = createStreamingRunner<ProseTransformOptions, { sourceContent: string; selectedText: string; guidance: string }>({
  name: 'librarian.prose-transform',
  role: 'librarian.prose-transform',
  maxSteps: 1,
  toolChoice: 'none',
  buildContext: false,
  readOnly: 'none',

  validate: async ({ dataDir, storyId, opts }) => {
    const fragment = await getFragment(dataDir, storyId, opts.fragmentId)
    if (!fragment) throw new Error(`Fragment ${opts.fragmentId} not found`)
    if (fragment.type !== 'prose') throw new Error(`Fragment ${opts.fragmentId} is not prose`)

    const sourceContent = (opts.sourceContent ?? fragment.content).trim()
    const selectedText = opts.selectedText.trim()
    if (!selectedText) throw new Error('Selected text is required')

    const guidance = opts.operation === 'custom'
      ? (opts.instruction || 'Improve the selected text.')
      : OPERATION_GUIDANCE[opts.operation]

    return { sourceContent, selectedText, guidance }
  },

  extraContext: async ({ opts, validated }) => ({
    operation: opts.operation,
    guidance: validated.guidance,
    selectedText: validated.selectedText,
    sourceContent: validated.sourceContent,
    contextBefore: opts.contextBefore,
    contextAfter: opts.contextAfter,
  }),

  afterStream: (result) => {
    result.completion.then((c) => {
      transformLogger.info('Prose transform completed', {
        stepCount: c.stepCount,
        finishReason: c.finishReason,
        outputLength: c.text.trim().length,
        reasoningLength: c.reasoning.trim().length,
      })
    }).catch(() => {})
  },
})
