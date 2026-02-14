import { generateText } from 'ai'
import { defaultModel } from '../llm/client'
import { getStory, updateStory, listFragments, getFragment } from '../fragments/storage'
import {
  saveAnalysis,
  getState,
  saveState,
  type LibrarianAnalysis,
} from './storage'
import { createLogger } from '../logging'

const logger = createLogger('librarian-agent')

const SYSTEM_PROMPT = `You are a librarian agent for a collaborative writing app. Your job is to analyze new prose fragments and maintain story continuity.

Given the story context (summary, characters, knowledge) and a newly written prose fragment, produce a JSON analysis with these fields:

{
  "summaryUpdate": "A 1-2 sentence addition to the running story summary describing what happened in this new prose.",
  "mentionedCharacters": ["ch-xxxx"],
  "contradictions": [{"description": "what contradicts what", "fragmentIds": ["pr-xxxx", "kn-xxxx"]}],
  "knowledgeSuggestions": [{"type": "character|knowledge", "name": "short name", "description": "max 50 chars", "content": "details worth remembering"}],
  "timelineEvents": [{"event": "what happened", "position": "before|during|after"}]
}

Rules:
- mentionedCharacters: only include character IDs from the provided list that are actually referenced in the new prose (by name or clear reference).
- contradictions: flag when the new prose contradicts established facts in the summary, character descriptions, or knowledge. Only flag clear contradictions, not ambiguities.
- knowledgeSuggestions: suggest new fragments for important details introduced in the new prose that aren't already captured. Set type to "character" for new characters or "knowledge" for world-building details, locations, items, or facts.
- timelineEvents: note significant events. "position" is relative to the previous prose: "before" if it's a flashback, "during" if concurrent, "after" if it follows sequentially.
- If there are no contradictions, suggestions, or timeline events, use empty arrays.

Respond with ONLY valid JSON, no markdown fences or extra text.`

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

function parseAnalysisResponse(raw: string): Omit<LibrarianAnalysis, 'id' | 'createdAt' | 'fragmentId'> {
  // Strip markdown fences if the LLM included them
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const parsed = JSON.parse(cleaned)

  return {
    summaryUpdate: typeof parsed.summaryUpdate === 'string' ? parsed.summaryUpdate : '',
    mentionedCharacters: Array.isArray(parsed.mentionedCharacters) ? parsed.mentionedCharacters : [],
    contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions : [],
    knowledgeSuggestions: Array.isArray(parsed.knowledgeSuggestions) ? parsed.knowledgeSuggestions : [],
    timelineEvents: Array.isArray(parsed.timelineEvents) ? parsed.timelineEvents : [],
  }
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

  // Load current librarian state for context
  const state = await getState(dataDir, storyId)

  // Build the prompt
  const userPrompt = buildUserPrompt(
    story.summary,
    characters.map((c) => ({ id: c.id, name: c.name, description: c.description })),
    knowledge.map((k) => ({ id: k.id, name: k.name, content: k.content })),
    { id: fragment.id, content: fragment.content },
  )

  // Call the LLM
  requestLogger.info('Calling LLM for analysis...')
  const llmStartTime = Date.now()
  const result = await generateText({
    model: defaultModel,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  })
  const llmDurationMs = Date.now() - llmStartTime
  requestLogger.info('LLM analysis completed', { durationMs: llmDurationMs })

  // Parse the response
  const parsed = parseAnalysisResponse(result.text)
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
