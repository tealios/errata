import { getModel, buildProviderOptions } from '../llm/client'
import { ToolLoopAgent, stepCountIs, type ProviderOptions } from 'ai'
import { instructionRegistry } from '../instructions'
import {
  getStory,
  listFragments,
  getFragment,
  updateFragment,
  createFragment,
  archiveFragment,
  migrateStoryToSummaryFragments,
} from '../fragments/storage'
import { getActiveProseIds, getProseChain } from '../fragments/prose-chain'
import { generateFragmentId } from '@/lib/fragment-ids'
import type { Fragment } from '../fragments/schema'
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
import { compileAgentContext } from '../agents/compile-agent-context'
import { createEmptyCollector, createAnalysisTools } from './analysis-tools'
import { buildAnalyzeSystemPrompt } from './blocks'
import {
  createAnalysisBuffer,
  pushEvent,
  finishBuffer,
  clearBuffer,
} from './analysis-stream'
import { getFragmentsByTag } from '../fragments/associations'
import type { AgentBlockContext } from '../agents/agent-block-context'

const logger = createLogger('librarian-agent')

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
  const { model, modelId, providerId, config, temperature } = await getModel(dataDir, storyId, { role: 'librarian.analyze' })

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
  const disableDirections = story.settings?.disableLibrarianDirections === true
  const disableSuggestions = story.settings?.disableLibrarianSuggestions === true
  const collector = createEmptyCollector()
  const analysisTools = createAnalysisTools(collector, { dataDir, storyId, disableDirections, disableSuggestions })

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

  // Override system prompt when directions or suggestions are disabled
  if ((disableDirections || disableSuggestions) && systemMessage) {
    systemMessage.content = buildAnalyzeSystemPrompt({ disableDirections, disableSuggestions }).trim()
  }

  const providerOptions = buildProviderOptions(story.settings.disableThinking ?? false)
  const agent = new ToolLoopAgent({
    model,
    instructions: systemMessage?.content || 'You are a helpful assistant.',
    tools: compiled.tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(3),
    temperature,
    providerOptions,
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

  const autoApplySuggestions = story.settings?.autoApplyLibrarianSuggestions === true && !disableSuggestions
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

// ── Summary-fragment helpers ─────────────────────────────────

/** Characters past which a chapter summary fragment splits into an era. */
const SUMMARY_OVERFLOW_THRESHOLD = 2000

/**
 * Walk the prose chain backward from the given prose fragment and return the
 * nearest preceding chapter marker's fragment ID. Returns null if the prose
 * sits before any marker (or outside the chain).
 */
async function findChapterForProse(
  dataDir: string,
  storyId: string,
  proseId: string,
): Promise<string | null> {
  const chain = await getProseChain(dataDir, storyId)
  if (!chain) return null
  const idx = chain.entries.findIndex(e => e.active === proseId)
  if (idx < 0) return null
  for (let i = idx - 1; i >= 0; i--) {
    const entry = chain.entries[i]
    const fragment = await getFragment(dataDir, storyId, entry.active)
    if (fragment?.type === 'marker') return fragment.id
  }
  return null
}

/** First un-archived summary fragment whose meta.chapterId matches, or null. */
async function findActiveChapterSummary(
  dataDir: string,
  storyId: string,
  chapterId: string | null,
): Promise<Fragment | null> {
  const summaries = await listFragments(dataDir, storyId, 'summary')
  for (const f of summaries) {
    if ((f.meta?.chapterId ?? null) === chapterId && !f.meta?.isEraSummary) {
      return f
    }
  }
  return null
}

function makeSummaryFragment(params: {
  chapterId: string | null
  chapterName: string
  content: string
  isEraSummary: boolean
  coverageStart: string | null
  coverageEnd: string | null
  analysisIds: string[]
}): Fragment {
  const now = new Date().toISOString()
  const nameBase = params.chapterName || 'Pre-chapter'
  return {
    id: generateFragmentId('summary'),
    type: 'summary',
    name: params.isEraSummary ? `${nameBase} — earlier` : `${nameBase} summary`,
    description: params.isEraSummary
      ? 'Compacted summary of earlier prose in this chapter.'
      : 'Running summary maintained by the librarian.',
    content: params.content,
    tags: [],
    refs: [],
    sticky: false,
    placement: 'system',
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {
      chapterId: params.chapterId,
      isEraSummary: params.isEraSummary,
      coverageStart: params.coverageStart,
      coverageEnd: params.coverageEnd,
      analysisIds: params.analysisIds,
    },
    archived: false,
    version: 1,
    versions: [],
  }
}

/**
 * If the combined content exceeds the overflow threshold, split the oldest
 * half into a compacted era summary (separate fragment), archive the original
 * chapter summary, and create a fresh chapter summary with the newer half.
 * Returns the fragment that should be treated as the active chapter summary
 * after the split (either the original untouched, or the freshly created one).
 */
async function appendAndMaybeSplit(
  dataDir: string,
  storyId: string,
  fragment: Fragment,
  appendText: string,
  newAnalysisIds: string[],
  newCoverageEnd: string,
  chapterName: string,
): Promise<Fragment> {
  const combined = fragment.content
    ? `${fragment.content}\n\n${appendText}`
    : appendText

  const existingIds = Array.isArray(fragment.meta?.analysisIds)
    ? (fragment.meta.analysisIds as string[])
    : []
  const analysisIds = [...existingIds, ...newAnalysisIds]
  const coverageStart = (fragment.meta?.coverageStart as string | null | undefined) ?? null
  const chapterId = (fragment.meta?.chapterId as string | null | undefined) ?? null

  if (combined.length <= SUMMARY_OVERFLOW_THRESHOLD) {
    const updated: Fragment = {
      ...fragment,
      content: combined,
      meta: {
        ...fragment.meta,
        analysisIds,
        coverageEnd: newCoverageEnd,
        coverageStart: coverageStart ?? (analysisIds.length > 0 ? newCoverageEnd : null),
      },
      updatedAt: new Date().toISOString(),
    }
    await updateFragment(dataDir, storyId, updated)
    return updated
  }

  // Split. Find a paragraph boundary near the midpoint to keep paragraphs intact.
  const midGuess = Math.floor(combined.length * 0.5)
  const boundary = combined.indexOf('\n\n', midGuess)
  const splitAt = boundary > 0 ? boundary : midGuess
  const olderHalf = combined.slice(0, splitAt).trim()
  const newerHalf = combined.slice(splitAt).trim()

  const compacted = compactSummaryByCharacters(
    olderHalf,
    SUMMARY_OVERFLOW_THRESHOLD,
    Math.floor(SUMMARY_OVERFLOW_THRESHOLD * 0.75),
  )

  const eraSummary = makeSummaryFragment({
    chapterId,
    chapterName,
    content: compacted,
    isEraSummary: true,
    coverageStart,
    coverageEnd: null,
    analysisIds,
  })
  await createFragment(dataDir, storyId, eraSummary)

  await archiveFragment(dataDir, storyId, fragment.id)

  const fresh = makeSummaryFragment({
    chapterId,
    chapterName,
    content: newerHalf,
    isEraSummary: false,
    coverageStart: newCoverageEnd,
    coverageEnd: newCoverageEnd,
    analysisIds: [],
  })
  await createFragment(dataDir, storyId, fresh)
  return fresh
}

async function nameForChapter(
  dataDir: string,
  storyId: string,
  chapterId: string | null,
): Promise<string> {
  if (!chapterId) return 'Opening'
  const marker = await getFragment(dataDir, storyId, chapterId)
  return marker?.name || 'Chapter'
}

/**
 * Apply summaries from analyses whose fragments are now old enough
 * (past the summarization threshold from the end of the prose chain).
 *
 * Writes to summary fragments grouped by chapter. Also dual-writes the
 * legacy story.summary field during the transition — phase 3 drops that.
 */
async function applyDeferredSummaries(
  dataDir: string,
  storyId: string,
  story: Awaited<ReturnType<typeof getStory>> & {},
  state: { summarizedUpTo: string | null } & Record<string, unknown>,
  requestLogger: ReturnType<typeof logger.child>,
) {
  // Migrate legacy story.summary → summary fragment once, before we write
  // new summary fragments, so existing rolling-summary content is preserved
  // and not orphaned on story.summary.
  await migrateStoryToSummaryFragments(dataDir, storyId)

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

  // Collect items in prose-chain order, stopping at first gap.
  type PendingItem = {
    proseId: string
    analysisId: string
    text: string
    chapterId: string | null
  }
  const items: PendingItem[] = []
  let lastAppliedId: string | null = state.summarizedUpTo

  for (let i = startIndex; i < cutoffIndex; i++) {
    const proseId = proseIds[i]

    // Markers sit in the prose chain as structural dividers, not prose.
    // Skip them without treating the absence of an analysis as a gap —
    // otherwise a marker placed anywhere would block all summaries past it.
    const entryFragment = await getFragment(dataDir, storyId, proseId)
    if (entryFragment?.type === 'marker') {
      lastAppliedId = proseId
      continue
    }

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

    const chapterId = await findChapterForProse(dataDir, storyId, proseId)
    items.push({ proseId, analysisId, text: update, chapterId })
    lastAppliedId = proseId
  }

  if (items.length === 0) {
    requestLogger.debug('No summaries to apply from deferred batch')
    return
  }

  // Group by chapter (preserving first-seen order so pre-chapter items
  // group ahead of the first real chapter).
  const byChapter = new Map<string | null, PendingItem[]>()
  for (const item of items) {
    const list = byChapter.get(item.chapterId)
    if (list) list.push(item)
    else byChapter.set(item.chapterId, [item])
  }

  const fragmentAssignments = new Map<string, string>() // analysisId → summaryFragmentId

  for (const [chapterId, chapterItems] of byChapter) {
    const chapterName = await nameForChapter(dataDir, storyId, chapterId)
    const existing = await findActiveChapterSummary(dataDir, storyId, chapterId)

    const appendText = chapterItems.map(i => i.text).join('\n\n')
    const newAnalysisIds = chapterItems.map(i => i.analysisId)
    const coverageEnd = chapterItems[chapterItems.length - 1].proseId

    let active: Fragment
    if (existing) {
      active = await appendAndMaybeSplit(
        dataDir,
        storyId,
        existing,
        appendText,
        newAnalysisIds,
        coverageEnd,
        chapterName,
      )
    } else {
      const fresh = makeSummaryFragment({
        chapterId,
        chapterName,
        content: appendText,
        isEraSummary: false,
        coverageStart: chapterItems[0].proseId,
        coverageEnd,
        analysisIds: newAnalysisIds,
      })
      await createFragment(dataDir, storyId, fresh)
      active = fresh
    }

    for (const item of chapterItems) {
      fragmentAssignments.set(item.analysisId, active.id)
    }
  }

  // Update each contributing analysis with the fragment it ended up in.
  for (const item of items) {
    const fragmentId = fragmentAssignments.get(item.analysisId)
    if (!fragmentId) continue
    const analysis = await getAnalysis(dataDir, storyId, item.analysisId)
    if (!analysis) continue
    if (analysis.summaryFragmentId === fragmentId) continue
    await saveAnalysis(dataDir, storyId, { ...analysis, summaryFragmentId: fragmentId })
  }

  // Update state with new watermark
  const currentState = await getState(dataDir, storyId)
  await saveState(dataDir, storyId, {
    ...currentState,
    summarizedUpTo: lastAppliedId,
  })

  requestLogger.info('Deferred summaries applied', {
    count: items.length,
    summarizedUpTo: lastAppliedId,
    totalSummaryLength: items.reduce((n, x) => n + x.text.length, 0),
    chapters: byChapter.size,
  })
}
