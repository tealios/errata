import { getModel } from '../llm/client'
import { getStory, updateStory, listFragments, getFragment, updateFragment } from '../fragments/storage'
import { getActiveProseIds } from '../fragments/prose-chain'
import { withBranch } from '../fragments/branches'
import {
  saveAnalysis,
  getLatestAnalysisIdsByFragment,
  getAnalysis,
  getState,
  saveState,
  type LibrarianAnalysis,
} from './storage'
import { applyKnowledgeSuggestion } from './suggestions'
import { createLogger } from '../logging'
import { createLibrarianAnalyzeToolAgent } from './llm-agents'
import { createEmptyCollector, createAnalysisTools } from './analysis-tools'
import {
  createAnalysisBuffer,
  pushEvent,
  finishBuffer,
  clearBuffer,
} from './analysis-stream'
import { getFragmentsByTag } from '../fragments/associations'

const logger = createLogger('librarian-agent')

const SYSTEM_PROMPT = `
You are a librarian agent for a collaborative writing app.
Your job is to analyze new prose fragments and maintain story continuity.

You have five reporting tools. Use them to report your findings:

1. updateSummary — Provide a concise summary of what happened in the new prose.
   - Also provide structured fields when possible: events[], stateChanges[], openThreads[].
   - If summary text is blank, structured fields are required.
2. reportMentions — Report each character reference by name, nickname, or title (not pronouns). Include the character ID and the exact text used.
3. reportContradictions — Flag when the new prose contradicts established facts in the summary, character descriptions, or knowledge. Only flag clear contradictions, not ambiguities.
4. suggestKnowledge — Suggest creating or updating character/knowledge fragments based on new information.
   - If an existing fragment should be refined, set targetFragmentId to that existing ID and provide the updated name/description/content.
   - If this is truly new information, omit targetFragmentId and suggest creating a new fragment.
   - Set type to "character" for characters or "knowledge" for world-building details, locations, items, or facts.
   - When updating a character or knowledge fragment, retain important established facts from the existing description in the updated content.
5. reportTimeline — Note significant events. "position" is relative to the previous prose: "before" if it's a flashback, "during" if concurrent, "after" if it follows sequentially.

Always call updateSummary. Only call the other tools if there are relevant findings.
If there are no contradictions, suggestions, mentions, or timeline events, don't call those tools.
Only return 'Analysis complete' in your final output. 
`

const DEFAULT_SUMMARY_COMPACT = {
  maxCharacters: 12000,
  targetCharacters: 9000,
} as const

function resolveSummaryCompact(story: Awaited<ReturnType<typeof getStory>> & {}): {
  maxCharacters: number
  targetCharacters: number
} {
  const raw = story?.settings && typeof story.settings === 'object'
    ? (story.settings as Record<string, unknown>).summaryCompact
    : null

  if (!raw || typeof raw !== 'object') return DEFAULT_SUMMARY_COMPACT

  const max = typeof (raw as Record<string, unknown>).maxCharacters === 'number'
    ? Math.max(100, Math.floor((raw as Record<string, unknown>).maxCharacters as number))
    : DEFAULT_SUMMARY_COMPACT.maxCharacters
  const targetCandidate = typeof (raw as Record<string, unknown>).targetCharacters === 'number'
    ? Math.max(100, Math.floor((raw as Record<string, unknown>).targetCharacters as number))
    : DEFAULT_SUMMARY_COMPACT.targetCharacters

  return {
    maxCharacters: max,
    targetCharacters: Math.min(targetCandidate, max),
  }
}

function compactSummaryByCharacters(summary: string, maxCharacters: number, targetCharacters: number): string {
  const normalized = summary.trim()
  if (normalized.length <= maxCharacters) return normalized

  const target = Math.min(Math.max(100, targetCharacters), maxCharacters)
  if (normalized.length <= target) return normalized

  // Keep the newest summary information by preserving the tail.
  const prefix = '... '
  const bodyLimit = Math.max(1, target - prefix.length)
  const tail = normalized.slice(-bodyLimit).trimStart()
  const compacted = `${prefix}${tail}`
  return compacted.length <= target ? compacted : compacted.slice(-target)
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
  return withBranch(dataDir, storyId, () => runLibrarianInner(dataDir, storyId, fragmentId))
}

async function runLibrarianInner(
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

  // Resolve model for this story (with request config such as custom headers/user-agent)
  const { model, modelId, providerId, config } = await getModel(dataDir, storyId, { role: 'librarian' })

  // Create collector and analysis tools
  const collector = createEmptyCollector()
  const analysisTools = createAnalysisTools(collector)

  // Create event buffer for live streaming
  const buffer = createAnalysisBuffer(storyId)

  // Call the LLM with tool-based analysis
  requestLogger.info('Calling LLM for analysis...')
  const llmStartTime = Date.now()
  const requestHeaders = {
    ...config.headers,
    'User-Agent': config.headers['User-Agent'] ?? 'errata-librarian/1.0',
  }

  let sys = SYSTEM_PROMPT
  let sysFragIds = await getFragmentsByTag(dataDir, storyId, 'pass-to-librarian-system-prompt')
  let sysFrags = []
  for (const id of sysFragIds) {
    const frag = await getFragment(dataDir, storyId, id)
    if (frag) {
      requestLogger.debug('Adding system prompt fragment to context', { fragmentId: frag.id, name: frag.name })
      sysFrags.push(frag)
    }
  }

  sys += '\n\n' + sysFrags.map((frag) => `## ${frag.name}\n${frag.content}`).join('\n\n')
  

  const agent = createLibrarianAnalyzeToolAgent({
    model,
    instructions: sys,
    tools: analysisTools,
    maxSteps: 3,
  })

  let fullText = ''
  let stepCount = 0
  let lastFinishReason = 'unknown'

  try {
    const result = await agent.stream({
      prompt: userPrompt,
    })

    // Iterate fullStream, mapping events to buffer (same pattern as chat.ts)
    for await (const part of result.fullStream) {
      const p = part as Record<string, unknown>

      switch (part.type) {
        case 'text-delta': {
          const text = (p.text ?? '') as string
          fullText += text
          pushEvent(buffer, { type: 'text', text })
          break
        }
        case 'reasoning-delta': {
          const text = (p.text ?? '') as string
          pushEvent(buffer, { type: 'reasoning', text })
          break
        }
        case 'tool-call': {
          const input = (p.input ?? {}) as Record<string, unknown>
          pushEvent(buffer, {
            type: 'tool-call',
            id: p.toolCallId as string,
            toolName: p.toolName as string,
            args: input,
          })
          break
        }
        case 'tool-result': {
          pushEvent(buffer, {
            type: 'tool-result',
            id: p.toolCallId as string,
            toolName: (p.toolName as string) ?? '',
            result: p.output,
          })
          break
        }
        case 'finish':
          lastFinishReason = (p.finishReason as string) ?? 'unknown'
          stepCount++
          break
      }
    }

    // Emit final finish event
    pushEvent(buffer, {
      type: 'finish',
      finishReason: lastFinishReason,
      stepCount,
    })
    finishBuffer(buffer)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    pushEvent(buffer, { type: 'error', error: errorMsg })
    finishBuffer(buffer, errorMsg)
    throw err
  }

  const llmDurationMs = Date.now() - llmStartTime
  requestLogger.info('LLM analysis completed', {
    durationMs: llmDurationMs,
    providerId,
    modelId,
    providerName: config.providerName,
    baseURL: config.baseURL,
    headers: Object.keys(requestHeaders),
  })

  // Fallback: if collector.summaryUpdate is empty but the LLM produced text, use it
  if (!collector.summaryUpdate && fullText.trim()) {
    collector.summaryUpdate = fullText.trim()
  }

  // Derive mentionedCharacters from mentions
  const mentionedCharacterIds = [...new Set(collector.mentions.map(m => m.characterId))]

  requestLogger.debug('Analysis parsed', {
    mentions: collector.mentions.length,
    mentionedCharacters: mentionedCharacterIds.length,
    contradictions: collector.contradictions.length,
    knowledgeSuggestions: collector.knowledgeSuggestions.length,
    timelineEvents: collector.timelineEvents.length,
  })

  // Build the analysis
  const analysisId = `la-${Date.now().toString(36)}`
  const analysis: LibrarianAnalysis = {
    id: analysisId,
    createdAt: new Date().toISOString(),
    fragmentId,
    summaryUpdate: collector.summaryUpdate,
    structuredSummary: collector.structuredSummary,
    mentionedCharacters: mentionedCharacterIds,
    mentions: collector.mentions,
    contradictions: collector.contradictions,
    timelineEvents: collector.timelineEvents,
    knowledgeSuggestions: collector.knowledgeSuggestions.map((suggestion) => ({
      ...suggestion,
      sourceFragmentId: fragmentId,
    })),
    trace: buffer.events as LibrarianAnalysis['trace'],
  }

  const autoApplySuggestions = story.settings?.autoApplyLibrarianSuggestions === true
  if (autoApplySuggestions && analysis.knowledgeSuggestions.length > 0) {
    requestLogger.info('Auto-applying librarian suggestions', {
      suggestionCount: analysis.knowledgeSuggestions.length,
    })
    for (let index = 0; index < analysis.knowledgeSuggestions.length; index += 1) {
      try {
        const result = await applyKnowledgeSuggestion({
          dataDir,
          storyId,
          analysis,
          suggestionIndex: index,
          reason: 'auto-apply',
        })
        analysis.knowledgeSuggestions[index].accepted = true
        analysis.knowledgeSuggestions[index].autoApplied = true
        analysis.knowledgeSuggestions[index].createdFragmentId = result.fragmentId
      } catch (error) {
        requestLogger.error('Failed to auto-apply suggestion', {
          suggestionIndex: index,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  // Save librarian metadata to the prose fragment (summary + mention annotations)
  const hasLibrarianSummary = !!collector.summaryUpdate
  const hasMentions = collector.mentions.length > 0

  if (hasLibrarianSummary || hasMentions) {
    const proseFragment = await getFragment(dataDir, storyId, fragmentId)
    if (proseFragment) {
      const updatedMeta = { ...proseFragment.meta }

      if (hasLibrarianSummary) {
        const existing = (updatedMeta._librarian ?? {}) as Record<string, unknown>
        updatedMeta._librarian = { ...existing, summary: collector.summaryUpdate, analysisId }
      }

      if (hasMentions) {
        updatedMeta.annotations = collector.mentions.map(m => ({
          type: 'mention' as const,
          fragmentId: m.characterId,
          text: m.text,
        }))
      }

      await updateFragment(dataDir, storyId, {
        ...proseFragment,
        meta: updatedMeta,
      })
      requestLogger.debug('Saved librarian metadata to prose fragment', {
        fragmentId,
        hasSummary: hasLibrarianSummary,
        annotationCount: hasMentions ? collector.mentions.length : 0,
      })
    }
  }

  // Update librarian state
  requestLogger.debug('Updating librarian state...')
  const updatedMentions = { ...state.recentMentions }
  for (const charId of mentionedCharacterIds) {
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
    summarizedUpTo: state.summarizedUpTo ?? null,
    recentMentions: updatedMentions,
    timeline: updatedTimeline,
  }

  // Save analysis first (with summaryUpdate preserved for deferred application)
  await saveAnalysis(dataDir, storyId, analysis)
  await saveState(dataDir, storyId, updatedState)
  requestLogger.info('Analysis saved', { analysisId })

  // Deferred summary application: apply summaries for fragments that have
  // aged past the threshold. This lets the author refine/reiterate recent
  // prose without those edits being baked into the rolling summary yet.
  await applyDeferredSummaries(dataDir, storyId, story, updatedState, requestLogger)

  // Clean up buffer after analysis is saved
  clearBuffer(storyId)

  return analysis
}

/**
 * Apply summaries from analyses whose fragments are now old enough
 * (past the summarization threshold from the end of the prose chain).
 *
 * Summaries are applied in prose-chain order, and `state.summarizedUpTo`
 * tracks progress so each summary is only applied once.
 */
async function applyDeferredSummaries(
  dataDir: string,
  storyId: string,
  story: Awaited<ReturnType<typeof getStory>> & {},
  state: { summarizedUpTo: string | null } & Record<string, unknown>,
  requestLogger: ReturnType<typeof logger.child>,
) {
  const proseIds = await getActiveProseIds(dataDir, storyId)
  const threshold = (story.settings?.summarizationThreshold as number | undefined) ?? 4
  const cutoffIndex = proseIds.length - threshold

  if (cutoffIndex <= 0) {
    requestLogger.debug('Not enough prose for deferred summarization', {
      proseCount: proseIds.length,
      threshold,
    })
    return
  }

  // Find where we left off
  const summarizedUpToIndex = state.summarizedUpTo
    ? proseIds.indexOf(state.summarizedUpTo)
    : -1
  const startIndex = summarizedUpToIndex + 1

  if (startIndex >= cutoffIndex) {
    requestLogger.debug('No new fragments to summarize', {
      summarizedUpTo: state.summarizedUpTo,
      cutoffIndex,
    })
    return
  }

  // Load latest analysis IDs by fragment from index (rebuilds index if missing)
  const analysisByFragment = await getLatestAnalysisIdsByFragment(dataDir, storyId)

  // Collect summaries in prose-chain order, stopping at first gap.
  // This guarantees contiguous progress from summarizedUpTo.
  const summaryParts: string[] = []
  let lastAppliedId: string | null = state.summarizedUpTo

  for (let i = startIndex; i < cutoffIndex; i++) {
    const proseId = proseIds[i]
    const analysisId = analysisByFragment.get(proseId)
    if (!analysisId) {
      requestLogger.debug('Deferred summarization stopped at gap', {
        gapFragmentId: proseId,
        gapReason: 'missing_analysis',
      })
      break
    }

    const analysis = await getAnalysis(dataDir, storyId, analysisId)
    const update = analysis?.summaryUpdate?.trim()
    if (!update) {
      requestLogger.debug('Deferred summarization stopped at gap', {
        gapFragmentId: proseId,
        gapReason: 'empty_summary_update',
      })
      break
    }

    summaryParts.push(update)
    lastAppliedId = proseId
  }

  if (summaryParts.length === 0) {
    requestLogger.debug('No summaries to apply from deferred batch')
    return
  }

  // Apply all collected summaries at once
  const currentStory = await getStory(dataDir, storyId)
  if (!currentStory) return

  const separator = currentStory.summary ? ' ' : ''
  const summaryCompact = resolveSummaryCompact(currentStory)
  const combinedSummary = currentStory.summary + separator + summaryParts.join(' ')
  const updatedStory = {
    ...currentStory,
    summary: compactSummaryByCharacters(
      combinedSummary,
      summaryCompact.maxCharacters,
      summaryCompact.targetCharacters,
    ),
    updatedAt: new Date().toISOString(),
  }
  await updateStory(dataDir, updatedStory)

  // Update state with new watermark
  const currentState = await getState(dataDir, storyId)
  await saveState(dataDir, storyId, {
    ...currentState,
    summarizedUpTo: lastAppliedId,
  })

  requestLogger.info('Deferred summaries applied', {
    count: summaryParts.length,
    summarizedUpTo: lastAppliedId,
    totalSummaryLength: summaryParts.join(' ').length,
  })
}
