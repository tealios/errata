import { getModel } from '../llm/client'
import { ToolLoopAgent, stepCountIs } from 'ai'
import { instructionRegistry } from '../instructions'
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
import { applyFragmentSuggestion } from './suggestions'
import { reportUsage } from '../llm/token-tracker'
import { createLogger } from '../logging'
import { createToolAgent } from '../agents/create-agent'
import { compileAgentContext } from '../agents/compile-agent-context'
import { createEmptyCollector, createAnalysisTools } from './analysis-tools'
import {
  createAnalysisBuffer,
  pushEvent,
  finishBuffer,
  clearBuffer,
} from './analysis-stream'
import { getFragmentsByTag } from '../fragments/associations'
import type { AgentBlockContext } from '../agents/agent-block-context'

const logger = createLogger('librarian-agent')

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

export const SUMMARY_COMPACTION_PROMPT = `You compress long rolling story summaries.
Keep key continuity facts, active constraints, unresolved threads, and recent causal chain.
Do not add new facts.
Return only compressed summary text.`

async function compactSummary(
  dataDir: string,
  storyId: string,
  summary: string,
  maxCharacters: number,
  targetCharacters: number,
  requestLogger: ReturnType<typeof logger.child>,
): Promise<string> {
  const normalized = summary.trim()
  if (normalized.length <= maxCharacters) return normalized

  const target = Math.min(Math.max(100, targetCharacters), maxCharacters)
  if (normalized.length <= target) return normalized

  try {
    const { model, modelId } = await getModel(dataDir, storyId, { role: 'librarian.analyze' })
    const agent = new ToolLoopAgent({
      model,
      instructions: instructionRegistry.resolve('librarian.summary-compaction', modelId),
      tools: {},
      toolChoice: 'none' as const,
      stopWhen: stepCountIs(1),
    })

    let compacted = ''
    const result = await agent.stream({
      prompt: `Compress this story summary to at most ${target} characters while preserving continuity-critical facts.\n\n${normalized}`,
    })

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        const p = part as Record<string, unknown>
        compacted += String(p.text ?? '')
      }
    }

    // Track token usage for summary compaction
    try {
      const rawUsage = await result.totalUsage
      if (rawUsage && typeof rawUsage.inputTokens === 'number') {
        reportUsage(dataDir, storyId, 'librarian.summary-compaction', {
          inputTokens: rawUsage.inputTokens,
          outputTokens: rawUsage.outputTokens ?? 0,
        }, modelId)
      }
    } catch {
      // Some providers may not report usage
    }

    const compactedText = compacted.trim()
    if (compactedText.length > 0) {
      if (compactedText.length <= target) {
        requestLogger.info('Summary compacted via LLM', {
          modelId,
          beforeLength: normalized.length,
          afterLength: compactedText.length,
          targetCharacters: target,
        })
        return compactedText
      }

      const bounded = compactedText.slice(0, target).trimEnd()
      requestLogger.warn('Summary compaction exceeded target; hard-capping output', {
        modelId,
        beforeLength: normalized.length,
        generatedLength: compactedText.length,
        afterLength: bounded.length,
        targetCharacters: target,
      })
      return bounded
    }

    requestLogger.warn('Summary compaction returned empty output; falling back to truncation')
  } catch (error) {
    requestLogger.warn('Summary compaction failed; falling back to truncation', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return compactSummaryByCharacters(normalized, maxCharacters, target)
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

  // Load system prompt fragments
  const sysFragIds = await getFragmentsByTag(dataDir, storyId, 'pass-to-librarian-system-prompt')
  const systemPromptFragments = []
  for (const id of sysFragIds) {
    const frag = await getFragment(dataDir, storyId, id)
    if (frag) {
      requestLogger.debug('Adding system prompt fragment to context', { fragmentId: frag.id, name: frag.name })
      systemPromptFragments.push(frag)
    }
  }

  // Resolve model early so modelId is available for instruction resolution
  const { model, modelId, providerId, config } = await getModel(dataDir, storyId, { role: 'librarian.analyze' })

  // Build agent block context
  const blockContext: AgentBlockContext = {
    story,
    proseFragments: [],
    stickyGuidelines: [],
    stickyKnowledge: [],
    stickyCharacters: [],
    guidelineShortlist: [],
    knowledgeShortlist: [],
    characterShortlist: [],
    systemPromptFragments,
    allCharacters: characters,
    allKnowledge: knowledge,
    newProse: { id: fragment.id, content: fragment.content },
    modelId,
  }

  // Create collector and analysis tools
  const collector = createEmptyCollector()
  const analysisTools = createAnalysisTools(collector, { dataDir, storyId })

  // Compile context via block system
  const compiled = await compileAgentContext(dataDir, storyId, 'librarian.analyze', blockContext, analysisTools)

  // Create event buffer for live streaming
  const buffer = createAnalysisBuffer(storyId)

  // Call the LLM with tool-based analysis
  requestLogger.info('Calling LLM for analysis...')
  const llmStartTime = Date.now()
  const requestHeaders = {
    ...config.headers,
    'User-Agent': config.headers['User-Agent'] ?? 'errata-librarian/1.0',
  }

  // Extract system instructions from compiled messages
  const systemMessage = compiled.messages.find(m => m.role === 'system')
  const userMessage = compiled.messages.find(m => m.role === 'user')

  const agent = createToolAgent({
    model,
    instructions: systemMessage?.content || 'You are a helpful assistant.',
    tools: compiled.tools,
    maxSteps: 3,
  })

  let fullText = ''
  let stepCount = 0
  let lastFinishReason = 'unknown'

  try {
    const result = await agent.stream({
      prompt: userMessage?.content ?? '',
    })

    // Iterate fullStream, mapping events to buffer
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

    // Track token usage for librarian analysis
    try {
      const rawUsage = await result.totalUsage
      if (rawUsage && typeof rawUsage.inputTokens === 'number') {
        reportUsage(dataDir, storyId, 'librarian.analyze', {
          inputTokens: rawUsage.inputTokens,
          outputTokens: rawUsage.outputTokens ?? 0,
        }, modelId)
      }
    } catch {
      // Some providers may not report usage
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
    fragmentSuggestions: collector.fragmentSuggestions.length,
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
    fragmentSuggestions: collector.fragmentSuggestions.map((suggestion) => ({
      ...suggestion,
      sourceFragmentId: fragmentId,
    })),
    directions: collector.directions,
    trace: buffer.events as LibrarianAnalysis['trace'],
  }

  const autoApplySuggestions = story.settings?.autoApplyLibrarianSuggestions === true
  if (autoApplySuggestions && analysis.fragmentSuggestions.length > 0) {
    requestLogger.info('Auto-applying librarian suggestions', {
      suggestionCount: analysis.fragmentSuggestions.length,
    })
    for (let index = 0; index < analysis.fragmentSuggestions.length; index += 1) {
      try {
        const result = await applyFragmentSuggestion({
          dataDir,
          storyId,
          analysis,
          suggestionIndex: index,
          reason: 'auto-apply',
        })
        analysis.fragmentSuggestions[index].accepted = true
        analysis.fragmentSuggestions[index].autoApplied = true
        analysis.fragmentSuggestions[index].createdFragmentId = result.fragmentId
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

  // Deferred summary application
  await applyDeferredSummaries(dataDir, storyId, story, updatedState, requestLogger)

  // Clean up buffer after analysis is saved
  clearBuffer(storyId)

  return analysis
}

/**
 * Apply summaries from analyses whose fragments are now old enough
 * (past the summarization threshold from the end of the prose chain).
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

  // Load latest analysis IDs by fragment from index
  const analysisByFragment = await getLatestAnalysisIdsByFragment(dataDir, storyId)

  // Collect summaries in prose-chain order, stopping at first gap.
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
  const compactedSummary = await compactSummary(
    dataDir,
    storyId,
    combinedSummary,
    summaryCompact.maxCharacters,
    summaryCompact.targetCharacters,
    requestLogger,
  )

  const updatedStory = {
    ...currentStory,
    summary: compactedSummary,
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
