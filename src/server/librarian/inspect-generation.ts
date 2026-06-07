import { getFragment } from '../fragments/storage'
import { findGenerationLogByFragment, type GenerationLog } from '../llm/generation-logs'

/**
 * Which slice of a generation's debug record to return. Scoped so the librarian
 * can drill into one aspect without pulling the whole (often large) prompt into
 * its context.
 */
export type InspectAspect = 'summary' | 'prompt' | 'tools' | 'prewriter' | 'reasoning'

export const INSPECT_ASPECTS: InspectAspect[] = ['summary', 'prompt', 'tools', 'prewriter', 'reasoning']

function truncate(text: string | undefined | null, max: number): string | undefined {
  if (!text) return text ?? undefined
  return text.length > max ? `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]` : text
}

function baseFields(log: GenerationLog) {
  return {
    logId: log.id,
    createdAt: log.createdAt,
    model: log.model,
    durationMs: log.durationMs,
    stepCount: log.stepCount,
    finishReason: log.finishReason,
    stepsExceeded: log.stepsExceeded,
  }
}

/**
 * Shape a generation log into a bounded, aspect-scoped view suitable for an LLM
 * tool result. Pure — exported for testing.
 */
export function formatGenerationInspection(log: GenerationLog, aspect: InspectAspect = 'summary') {
  const base = baseFields(log)

  switch (aspect) {
    case 'prompt': {
      const system = log.messages.find((m) => m.role === 'system')?.content
      const user = log.messages.find((m) => m.role === 'user')?.content
      return { ...base, prompt: { system: truncate(system, 8000) ?? null, user: truncate(user, 8000) ?? null } }
    }
    case 'tools':
      return {
        ...base,
        toolCallCount: log.toolCalls.length,
        toolCalls: log.toolCalls.map((t) => ({
          toolName: t.toolName,
          args: t.args,
          result: truncate(typeof t.result === 'string' ? t.result : JSON.stringify(t.result), 800) ?? null,
        })),
      }
    case 'prewriter':
      if (!log.prewriterBrief && !log.prewriterMessages?.length) {
        return { ...base, prewriter: null, note: 'This fragment was not generated in prewriter mode.' }
      }
      return {
        ...base,
        prewriter: {
          model: log.prewriterModel ?? null,
          reasoningLevel: log.prewriterReasoning ?? null,
          durationMs: log.prewriterDurationMs ?? null,
          usage: log.prewriterUsage ?? null,
          brief: truncate(log.prewriterBrief, 8000) ?? null,
          directions: log.prewriterDirections ?? null,
        },
      }
    case 'reasoning':
      return {
        ...base,
        reasoning: truncate(log.reasoning, 12000) ?? null,
        note: log.reasoning ? undefined : 'No reasoning was captured (the model may not expose its thinking).',
      }
    case 'summary':
    default:
      return {
        ...base,
        input: log.input,
        tokens: log.totalUsage ?? null,
        toolsCalled: log.toolCalls.map((t) => t.toolName),
        prewriterMode: !!(log.prewriterBrief || log.prewriterMessages?.length),
        hasReasoning: !!log.reasoning,
        generatedPreview: truncate(log.generatedText, 600) ?? null,
        moreDetail: 'Call again with aspect: prompt | tools | prewriter | reasoning for the full record of that part.',
      }
  }
}

/**
 * Resolve and shape the generation debug record behind a prose fragment. Returns
 * an `{ error }` object (not a throw) so it reads cleanly as a tool result.
 */
export async function inspectGenerationForFragment(
  dataDir: string,
  storyId: string,
  fragmentId: string,
  aspect: InspectAspect = 'summary',
): Promise<Record<string, unknown>> {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) return { error: `Fragment ${fragmentId} not found.` }

  const log = await findGenerationLogByFragment(dataDir, storyId, fragmentId)
  if (!log) {
    return {
      error: `No generation log found for ${fragmentId}. It may have been written or imported manually rather than generated, or its log was pruned.`,
    }
  }

  return formatGenerationInspection(log, aspect)
}
