import { tool } from 'ai'
import { z } from 'zod/v4'

// --- Collector ---

export interface AnalysisCollector {
  summaryUpdate: string
  structuredSummary: {
    events: string[]
    stateChanges: string[]
    openThreads: string[]
  }
  mentions: Array<{ characterId: string; text: string }>
  contradictions: Array<{ description: string; fragmentIds: string[] }>
  knowledgeSuggestions: Array<{
    type: 'character' | 'knowledge'
    targetFragmentId?: string
    name: string
    description: string
    content: string
  }>
  timelineEvents: Array<{ event: string; position: 'before' | 'during' | 'after' }>
}

export function createEmptyCollector(): AnalysisCollector {
  return {
    summaryUpdate: '',
    structuredSummary: {
      events: [],
      stateChanges: [],
      openThreads: [],
    },
    mentions: [],
    contradictions: [],
    knowledgeSuggestions: [],
    timelineEvents: [],
  }
}

function normalizeUniqueLines(values: string[] | undefined, maxItems: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values ?? []) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
    if (out.length >= maxItems) break
  }
  return out
}

function sentenceJoin(values: string[]): string {
  return values.map((v) => v.endsWith('.') ? v : `${v}.`).join(' ')
}

export function renderStructuredSummary(structured: {
  events: string[]
  stateChanges: string[]
  openThreads: string[]
}): string {
  const parts: string[] = []
  if (structured.events.length > 0) {
    parts.push(`Events: ${structured.events.join('; ')}.`)
  }
  if (structured.stateChanges.length > 0) {
    parts.push(`State changes: ${structured.stateChanges.join('; ')}.`)
  }
  if (structured.openThreads.length > 0) {
    parts.push(`Open threads: ${structured.openThreads.join('; ')}.`)
  }

  return sentenceJoin(parts).trim()
}

export const updateSummaryInputSchema = z.object({
  summary: z.string().max(1200).describe('A concise summary of what happened in the new prose fragment'),
  events: z.array(z.string().max(200)).max(12).optional()
    .describe('Bullet-like event statements from the prose fragment'),
  stateChanges: z.array(z.string().max(200)).max(12).optional()
    .describe('What changed in goals, relationships, world state, or character condition'),
  openThreads: z.array(z.string().max(200)).max(12).optional()
    .describe('Unresolved questions or threads introduced/advanced by this prose'),
}).superRefine((value, ctx) => {
  const hasSummary = value.summary.trim().length > 0
  const signalCount = (value.events?.length ?? 0) + (value.stateChanges?.length ?? 0) + (value.openThreads?.length ?? 0)
  if (!hasSummary && signalCount === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'Provide either summary text or at least one structured summary signal.',
    })
  }
})

// --- Tools ---

export function createAnalysisTools(collector: AnalysisCollector) {
  return {
    updateSummary: tool({
      description: 'Set or update the summary for this prose fragment. Describes what happened in the new prose. Last call wins.',
      inputSchema: updateSummaryInputSchema,
      execute: async ({ summary, events, stateChanges, openThreads }) => {
        const normalized = {
          events: normalizeUniqueLines(events, 8),
          stateChanges: normalizeUniqueLines(stateChanges, 8),
          openThreads: normalizeUniqueLines(openThreads, 8),
        }
        collector.structuredSummary = normalized

        const trimmedSummary = summary.trim()
        collector.summaryUpdate = trimmedSummary.length > 0
          ? trimmedSummary
          : renderStructuredSummary(normalized)
        return { ok: true }
      },
    }),

    reportMentions: tool({
      description: 'Report character mentions found in the new prose. Call once with all mentions.',
      inputSchema: z.object({
        mentions: z.array(z.object({
          characterId: z.string().describe('The character fragment ID (e.g. ch-abc)'),
          text: z.string().describe('The exact name, nickname, or title used to refer to the character (not pronouns)'),
        })),
      }),
      execute: async ({ mentions }) => {
        collector.mentions.push(...mentions)
        return { ok: true }
      },
    }),

    reportContradictions: tool({
      description: 'Report contradictions between the new prose and established facts. Only flag clear contradictions.',
      inputSchema: z.object({
        contradictions: z.array(z.object({
          description: z.string().describe('What the contradiction is'),
          fragmentIds: z.array(z.string()).describe('IDs of the fragments involved'),
        })),
      }),
      execute: async ({ contradictions }) => {
        collector.contradictions.push(...contradictions)
        return { ok: true }
      },
    }),

    suggestKnowledge: tool({
      description: 'Suggest creating or updating character/knowledge fragments based on new information in the prose.',
      inputSchema: z.object({
        suggestions: z.array(z.object({
          type: z.union([z.literal('character'), z.literal('knowledge')]).describe('"character" for characters, "knowledge" for world-building, locations, items, facts'),
          targetFragmentId: z.string().optional().describe('If updating an existing fragment, its ID. Omit for new fragments.'),
          name: z.string().describe('Name of the character or knowledge entry'),
          description: z.string().describe('Short description (max 250 chars)'),
          content: z.string().describe('Full content. Retain important established facts when updating.'),
        })),
      }),
      execute: async ({ suggestions }) => {
        collector.knowledgeSuggestions.push(...suggestions)
        return { ok: true }
      },
    }),

    reportTimeline: tool({
      description: 'Report significant timeline events from the new prose.',
      inputSchema: z.object({
        events: z.array(z.object({
          event: z.string().describe('Description of the event'),
          position: z.union([z.literal('before'), z.literal('during'), z.literal('after')]).describe('"before" for flashback, "during" for concurrent, "after" for sequential'),
        })),
      }),
      execute: async ({ events }) => {
        collector.timelineEvents.push(...events)
        return { ok: true }
      },
    }),
  }
}
