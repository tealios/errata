import { generateObject, generateText } from 'ai'
import { getModel } from '../llm/client'
import { getStory, updateStory, listFragments, getFragment } from '../fragments/storage'
import { getActiveProseIds } from '../fragments/prose-chain'
import {
  saveAnalysis,
  getState,
  saveState,
  type LibrarianAnalysis,
} from './storage'
import { createLogger } from '../logging'
import { z } from 'zod/v4'

const logger = createLogger('librarian-agent')

const SYSTEM_PROMPT = `You are a librarian agent for a collaborative writing app. Your job is to analyze new prose fragments and maintain story continuity.

Rules:
- mentionedCharacters: only include character IDs from the provided list that are actually referenced in the new prose (by name or clear reference).
- contradictions: flag when the new prose contradicts established facts in the summary, character descriptions, or knowledge. Only flag clear contradictions, not ambiguities.
- knowledgeSuggestions: suggest new fragments for important details introduced in the new prose that aren't already captured. Set type to "character" for new characters or "knowledge" for world-building details, locations, items, or facts.
- timelineEvents: note significant events. "position" is relative to the previous prose: "before" if it's a flashback, "during" if concurrent, "after" if it follows sequentially.
- If there are no contradictions, suggestions, or timeline events, use empty arrays.`

const LibrarianAnalysisSchema = z.object({
  summaryUpdate: z.string(),
  mentionedCharacters: z.array(z.string()),
  contradictions: z.array(z.object({
    description: z.string(),
    fragmentIds: z.array(z.string()),
  })),
  knowledgeSuggestions: z.array(z.object({
    type: z.union([z.literal('character'), z.literal('knowledge')]),
    name: z.string(),
    description: z.string(),
    content: z.string(),
  })),
  timelineEvents: z.array(z.object({
    event: z.string(),
    position: z.union([z.literal('before'), z.literal('during'), z.literal('after')]),
  })),
})

function isStructuredOutputUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('responseformat')
    || normalized.includes('structuredoutputs')
    || normalized.includes('json response format schema')
  )
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim()

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }

  return trimmed
}

async function generateStructuredAnalysisWithFallback(args: {
  model: Awaited<ReturnType<typeof getModel>>['model']
  system: string
  prompt: string
  headers: Record<string, string>
  requestLogger: ReturnType<typeof logger.child>
}) {
  try {
    const result = await generateObject({
      model: args.model,
      system: args.system,
      prompt: args.prompt,
      schema: LibrarianAnalysisSchema,
      headers: args.headers,
    })

    return result.object
  } catch (error) {
    if (!isStructuredOutputUnsupportedError(error)) {
      throw error
    }

    args.requestLogger.warn('Provider does not support schema responseFormat; falling back to JSON text mode')

    const fallbackPrompt = `${args.prompt}\n\nReturn ONLY valid JSON with keys: summaryUpdate, mentionedCharacters, contradictions, knowledgeSuggestions, timelineEvents.`
    const textResult = await generateText({
      model: args.model,
      system: args.system,
      prompt: fallbackPrompt,
      headers: args.headers,
    })

    const rawJson = extractJsonObject(textResult.text)
    const parsedJson = JSON.parse(rawJson)
    return LibrarianAnalysisSchema.parse(parsedJson)
  }
}

function buildUserPrompt(
  summary: string,
  characters: Array<{ id: string; name: string; description: string }>,
  knowledge: Array<{ id: string; name: string; content: string }>,
  newProse: { id: string; content: string },
): string {
  const parts: string[] = []

  parts.push('## Story Summary So Far')
  parts.push(summary || '(No summary yet — this may be the beginning of the story.)')
  parts.push('')

  if (characters.length > 0) {
    parts.push('## Known Characters')
    for (const ch of characters) {
      parts.push(`- ${ch.id}: ${ch.name} — ${ch.description}`)
    }
    parts.push('')
  }

  if (knowledge.length > 0) {
    parts.push('## Knowledge Base')
    for (const kn of knowledge) {
      parts.push(`- ${kn.id}: ${kn.name} — ${kn.content}`)
    }
    parts.push('')
  }

  parts.push('## New Prose Fragment')
  parts.push(`Fragment ID: ${newProse.id}`)
  parts.push(newProse.content)

  return parts.join('\n')
}

export async function runLibrarian(
  dataDir: string,
  storyId: string,
  fragmentId: string,
): Promise<LibrarianAnalysis> {
  const requestLogger = logger.child({ storyId })
  requestLogger.info('Starting librarian analysis...', { fragmentId })

  // Load story and fragment data
  const story = await getStory(dataDir, storyId)
  if (!story) {
    requestLogger.error('Story not found', { storyId })
    throw new Error(`Story ${storyId} not found`)
  }

  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) {
    requestLogger.error('Fragment not found', { fragmentId })
    throw new Error(`Fragment ${fragmentId} not found`)
  }

  // Load characters and knowledge
  requestLogger.debug('Loading characters and knowledge...')
  const characters = await listFragments(dataDir, storyId, 'character')
  const knowledge = await listFragments(dataDir, storyId, 'knowledge')
  requestLogger.debug('Data loaded', {
    characterCount: characters.length,
    knowledgeCount: knowledge.length,
  })

  // Check prose position to determine if we should summarize
  // Only summarize proses that are at least N positions back from the most recent
  const proseIds = await getActiveProseIds(dataDir, storyId)
  const proseIndex = proseIds.indexOf(fragmentId)
  const summarizationThreshold = story.settings?.summarizationThreshold ?? 4
  const shouldSummarize = proseIndex >= 0 && proseIndex < proseIds.length - summarizationThreshold

  requestLogger.debug('Prose position check', {
    proseIndex,
    totalProse: proseIds.length,
    threshold: summarizationThreshold,
    shouldSummarize
  })

  // Load current librarian state for context
  const state = await getState(dataDir, storyId)

  // Build the prompt
  const userPrompt = buildUserPrompt(
    story.summary,
    characters.map((c) => ({ id: c.id, name: c.name, description: c.description })),
    knowledge.map((k) => ({ id: k.id, name: k.name, content: k.content })),
    { id: fragment.id, content: fragment.content },
  )

  // Resolve model for this story (with request config such as custom headers/user-agent)
  const { model, modelId, providerId, config } = await getModel(dataDir, storyId)

  // Call the LLM
  requestLogger.info('Calling LLM for analysis...')
  const llmStartTime = Date.now()
  const requestHeaders = {
    ...config.headers,
    'User-Agent': config.headers['User-Agent'] ?? 'errata-librarian/1.0',
  }

  const parsed = await generateStructuredAnalysisWithFallback({
    model,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    headers: requestHeaders,
    requestLogger,
  })
  const llmDurationMs = Date.now() - llmStartTime
  requestLogger.info('LLM analysis completed', {
    durationMs: llmDurationMs,
    providerId,
    modelId,
    providerName: config.providerName,
    baseURL: config.baseURL,
    headers: Object.keys(requestHeaders),
  })

  requestLogger.debug('Analysis parsed', {
    mentionedCharacters: parsed.mentionedCharacters.length,
    contradictions: parsed.contradictions.length,
    knowledgeSuggestions: parsed.knowledgeSuggestions.length,
    timelineEvents: parsed.timelineEvents.length,
  })

  // Build the analysis
  const analysisId = `la-${Date.now().toString(36)}`
  const analysis: LibrarianAnalysis = {
    id: analysisId,
    createdAt: new Date().toISOString(),
    fragmentId,
    ...parsed,
  }

  // Only apply summary if prose is old enough (based on threshold)
  if (!shouldSummarize) {
    analysis.summaryUpdate = ''
    requestLogger.debug('Skipping summary - prose is too recent', {
      proseIndex,
      threshold: summarizationThreshold
    })
  }

  // Apply updates: append summary
  if (analysis.summaryUpdate) {
    requestLogger.info('Updating story summary', { summaryUpdateLength: analysis.summaryUpdate.length })
    const separator = story.summary ? ' ' : ''
    const updatedStory = {
      ...story,
      summary: story.summary + separator + analysis.summaryUpdate,
      updatedAt: new Date().toISOString(),
    }
    await updateStory(dataDir, updatedStory)
  }

  // Update librarian state
  requestLogger.debug('Updating librarian state...')
  const updatedMentions = { ...state.recentMentions }
  for (const charId of analysis.mentionedCharacters) {
    if (!updatedMentions[charId]) {
      updatedMentions[charId] = []
    }
    updatedMentions[charId].push(fragmentId)
  }

  const updatedTimeline = [...state.timeline]
  for (const event of analysis.timelineEvents) {
    updatedTimeline.push({ event: event.event, fragmentId })
  }

  const updatedState = {
    lastAnalyzedFragmentId: fragmentId,
    recentMentions: updatedMentions,
    timeline: updatedTimeline,
  }

  // Save everything
  await saveAnalysis(dataDir, storyId, analysis)
  await saveState(dataDir, storyId, updatedState)
  requestLogger.info('Analysis saved', { analysisId })

  return analysis
}
