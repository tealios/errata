import { getStory, listFragments, getFragment } from '../fragments/storage'
import { registry } from '../fragments/registry'
import { createLogger } from '../logging'
import { getActiveProseIds, findSectionIndex, getFullProseChain } from '../fragments/prose-chain'
import { getAnalysis, getLatestAnalysisIdsByFragment } from '../librarian/storage'
import type { Fragment, StoryMeta } from '../fragments/schema'

export interface ContextBuildState {
  story: StoryMeta
  proseFragments: Fragment[]
  chapterSummaries: Array<{
    markerId: string
    name: string
    summary: string
  }>
  stickyGuidelines: Fragment[]
  stickyKnowledge: Fragment[]
  stickyCharacters: Fragment[]
  guidelineShortlist: Fragment[]
  knowledgeShortlist: Fragment[]
  characterShortlist: Fragment[]
  authorInput: string
}

export interface ContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ContextBlock {
  id: string
  role: 'system' | 'user'
  content: string
  order: number
  source: 'builtin' | string
}

// --- Block manipulation utilities (pure, immutable) ---

export function findBlock(blocks: ContextBlock[], id: string): ContextBlock | undefined {
  return blocks.find(b => b.id === id)
}

export function replaceBlockContent(blocks: ContextBlock[], id: string, content: string): ContextBlock[] {
  return blocks.map(b => b.id === id ? { ...b, content } : b)
}

export function removeBlock(blocks: ContextBlock[], id: string): ContextBlock[] {
  return blocks.filter(b => b.id !== id)
}

export function insertBlockBefore(blocks: ContextBlock[], targetId: string, block: ContextBlock): ContextBlock[] {
  const idx = blocks.findIndex(b => b.id === targetId)
  if (idx === -1) return [...blocks, block]
  return [...blocks.slice(0, idx), block, ...blocks.slice(idx)]
}

export function insertBlockAfter(blocks: ContextBlock[], targetId: string, block: ContextBlock): ContextBlock[] {
  const idx = blocks.findIndex(b => b.id === targetId)
  if (idx === -1) return [...blocks, block]
  return [...blocks.slice(0, idx + 1), block, ...blocks.slice(idx + 1)]
}

export function reorderBlock(blocks: ContextBlock[], id: string, newOrder: number): ContextBlock[] {
  return blocks.map(b => b.id === id ? { ...b, order: newOrder } : b)
}

const DEFAULT_PROSE_LIMIT = 10
const logger = createLogger('context-builder')

export type ContextCompactType = 'proseLimit' | 'maxTokens' | 'maxCharacters'

export interface ContextCompactOption {
  type: ContextCompactType
  value: number
}

export interface BuildContextOptions {
  proseLimit?: number
  contextCompact?: ContextCompactOption
  /** Fragment ID to exclude from context (e.g., when regenerating) */
  excludeFragmentId?: string
  /** Only include prose that comes before this fragment in the active prose chain */
  proseBeforeFragmentId?: string
  /** Build summary only from librarian updates before this fragment */
  summaryBeforeFragmentId?: string
  /** Exclude story summary from context */
  excludeStorySummary?: boolean
}

/**
 * Applies the prose limit to a sorted array of prose fragments.
 * Supports three modes: proseLimit (count), maxTokens (estimated), maxCharacters.
 */
function applyProseLimit(
  sorted: Fragment[],
  compact: ContextCompactOption,
): Fragment[] {
  switch (compact.type) {
    case 'maxTokens': {
      const result: Fragment[] = []
      let budget = compact.value
      for (let i = sorted.length - 1; i >= 0; i--) {
        const tokens = Math.ceil(sorted[i].content.length / 4)
        if (budget - tokens < 0 && result.length > 0) break
        budget -= tokens
        result.unshift(sorted[i])
      }
      return result
    }
    case 'maxCharacters': {
      const result: Fragment[] = []
      let budget = compact.value
      for (let i = sorted.length - 1; i >= 0; i--) {
        const len = sorted[i].content.length
        if (budget - len < 0 && result.length > 0) break
        budget -= len
        result.unshift(sorted[i])
      }
      return result
    }
    default: // 'proseLimit'
      return sorted.slice(-compact.value)
  }
}

async function buildSummaryBeforeFragment(
  dataDir: string,
  storyId: string,
  fragmentIdsInOrder: string[],
): Promise<string> {
  if (fragmentIdsInOrder.length === 0) return ''

  const latestByFragment = await getLatestAnalysisIdsByFragment(dataDir, storyId)
  if (latestByFragment.size === 0) return ''

  const analysisIds = fragmentIdsInOrder
    .map((fragmentId) => latestByFragment.get(fragmentId))
    .filter((analysisId): analysisId is string => !!analysisId)

  if (analysisIds.length === 0) return ''

  const analyses = await Promise.all(analysisIds.map((analysisId) => getAnalysis(dataDir, storyId, analysisId)))
  const updates = analyses
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => a.summaryUpdate.trim())
    .filter((summary) => summary.length > 0)

  return updates.join(' ').trim()
}

async function resolveBeforeSectionIndex(
  dataDir: string,
  storyId: string,
  targetFragmentId: string,
  activeProseIds: string[],
): Promise<number> {
  const activeIndex = activeProseIds.indexOf(targetFragmentId)
  if (activeIndex !== -1) return activeIndex

  const sectionIndex = await findSectionIndex(dataDir, storyId, targetFragmentId)
  return sectionIndex
}

/**
 * Loads fragments and builds the intermediate state for context assembly.
 * This is the first step — hooks can modify this state before message assembly.
 */
export async function buildContextState(
  dataDir: string,
  storyId: string,
  authorInput: string,
  opts: BuildContextOptions = {},
): Promise<ContextBuildState> {
  const {
    proseLimit,
    contextCompact: optsContextCompact,
    excludeFragmentId,
    proseBeforeFragmentId,
    summaryBeforeFragmentId,
    excludeStorySummary,
  } = opts
  const requestLogger = logger.child({ storyId })
  requestLogger.info('Building context state...')

  const story = await getStory(dataDir, storyId)
  if (!story) {
    requestLogger.error('Story not found', { storyId })
    throw new Error(`Story not found: ${storyId}`)
  }

  // Load all fragments by type
  requestLogger.debug('Loading fragments by type...')
  const allGuidelines = await listFragments(dataDir, storyId, 'guideline')
  const allKnowledge = await listFragments(dataDir, storyId, 'knowledge')
  const allCharacters = await listFragments(dataDir, storyId, 'character')

  // Load prose from chain - get active prose fragment IDs
  // If no chain exists (empty array), fall back to listing all prose fragments
  let activeProseIds = await getActiveProseIds(dataDir, storyId)
  let proseFragments: Fragment[] = []

  if (activeProseIds.length === 0) {
    requestLogger.debug('No prose chain found, falling back to listing all prose')
    proseFragments = await listFragments(dataDir, storyId, 'prose')

    if (proseBeforeFragmentId) {
      const beforeFragment = await getFragment(dataDir, storyId, proseBeforeFragmentId)
      if (beforeFragment) {
        proseFragments = proseFragments.filter(f =>
          f.order < beforeFragment.order ||
          (f.order === beforeFragment.order && f.createdAt < beforeFragment.createdAt),
        )
      }
    }

    // Filter out excluded fragment
    if (excludeFragmentId) {
      proseFragments = proseFragments.filter(f => f.id !== excludeFragmentId)
    }
  } else {
    requestLogger.debug('Prose chain loaded', { activeProseCount: activeProseIds.length })

    if (proseBeforeFragmentId) {
      const beforeIndex = await resolveBeforeSectionIndex(
        dataDir,
        storyId,
        proseBeforeFragmentId,
        activeProseIds,
      )
      activeProseIds = beforeIndex >= 0
        ? activeProseIds.slice(0, beforeIndex)
        : []
    }

    // Load the actual prose fragments from chain, excluding the specified fragment
    for (const proseId of activeProseIds) {
      // Skip the excluded fragment
      if (excludeFragmentId && proseId === excludeFragmentId) {
        requestLogger.debug('Excluding fragment from context', { excludedId: excludeFragmentId })
        continue
      }
      const fragment = await getFragment(dataDir, storyId, proseId)
      if (fragment && !fragment.archived && fragment.type !== 'marker') {
        proseFragments.push(fragment)
      } else if (!fragment) {
        requestLogger.warn('Prose fragment not found in chain', { proseId })
      }
    }
  }

  requestLogger.debug('Fragments loaded', {
    proseCount: proseFragments.length,
    guidelineCount: allGuidelines.length,
    knowledgeCount: allKnowledge.length,
    characterCount: allCharacters.length,
  })

  // Sort prose by order, then createdAt
  const sortedProse = proseFragments.sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
  )

  // Resolve the prose compact option: opts override > legacy proseLimit > story setting > default
  const effectiveCompact: ContextCompactOption =
    optsContextCompact
    ?? (proseLimit !== undefined ? { type: 'proseLimit', value: proseLimit } : undefined)
    ?? (story.settings as Record<string, unknown>).contextCompact as ContextCompactOption | undefined
    ?? { type: 'proseLimit', value: DEFAULT_PROSE_LIMIT }

  // Apply the prose limit
  const recentProse = applyProseLimit(sortedProse, effectiveCompact)

  let chapterSummaries: Array<{ markerId: string; name: string; summary: string }> = []
  if (story.settings.enableHierarchicalSummary && activeProseIds.length > 0 && recentProse.length > 0) {
    const chain = await getFullProseChain(dataDir, storyId)
    if (chain) {
      const sectionByFragmentId = new Map(activeProseIds.map((id, idx) => [id, idx]))
      const recentSectionIndexes = recentProse
        .map((p) => sectionByFragmentId.get(p.id))
        .filter((idx): idx is number => idx !== undefined)

      if (recentSectionIndexes.length > 0) {
        const start = Math.min(...recentSectionIndexes)
        const end = Math.max(...recentSectionIndexes)
        const markerIndexes: number[] = []

        for (let i = 0; i < chain.entries.length; i++) {
          const entry = chain.entries[i]
          const activeId = entry.active
          const fragment = await getFragment(dataDir, storyId, activeId)
          if (fragment?.type === 'marker') {
            markerIndexes.push(i)
          }
        }

        for (let i = 0; i < markerIndexes.length; i++) {
          const markerIndex = markerIndexes[i]
          const nextMarkerIndex = markerIndexes[i + 1] ?? chain.entries.length
          const chapterStart = markerIndex + 1
          const chapterEnd = nextMarkerIndex - 1

          if (chapterEnd < chapterStart) continue
          if (chapterEnd < start || chapterStart > end) continue

          const markerId = chain.entries[markerIndex].active
          const marker = await getFragment(dataDir, storyId, markerId)
          if (!marker || marker.type !== 'marker') continue
          const summary = marker.content.trim()
          if (!summary) continue

          chapterSummaries.push({
            markerId: marker.id,
            name: marker.name,
            summary,
          })
        }
      }
    }
  }

  let effectiveSummary = story.summary
  if (excludeStorySummary) {
    effectiveSummary = ''
  } else if (summaryBeforeFragmentId) {
    let summaryContextIds: string[] = []
    if (activeProseIds.length > 0) {
      const beforeIndex = await resolveBeforeSectionIndex(
        dataDir,
        storyId,
        summaryBeforeFragmentId,
        activeProseIds,
      )
      summaryContextIds = beforeIndex !== -1
        ? activeProseIds.slice(0, beforeIndex)
        : []
    } else {
      const beforeFragment = await getFragment(dataDir, storyId, summaryBeforeFragmentId)
      if (beforeFragment) {
        const allProse = await listFragments(dataDir, storyId, 'prose')
        summaryContextIds = allProse
          .filter(f =>
            f.order < beforeFragment.order ||
            (f.order === beforeFragment.order && f.createdAt < beforeFragment.createdAt),
          )
          .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
          .map(f => f.id)
      }
    }
    effectiveSummary = await buildSummaryBeforeFragment(dataDir, storyId, summaryContextIds)
  }

  // Split guidelines, knowledge, and characters into sticky (full) vs shortlist
  const sortByOrder = (a: Fragment, b: Fragment) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)
  const stickyGuidelines = allGuidelines.filter((f) => f.sticky).sort(sortByOrder)
  const nonStickyGuidelines = allGuidelines.filter((f) => !f.sticky)
  const stickyKnowledge = allKnowledge.filter((f) => f.sticky).sort(sortByOrder)
  const nonStickyKnowledge = allKnowledge.filter((f) => !f.sticky)
  const stickyCharacters = allCharacters.filter((f) => f.sticky).sort(sortByOrder)
  const nonStickyCharacters = allCharacters.filter((f) => !f.sticky)

  const state = {
    story: { ...story, summary: effectiveSummary },
    proseFragments: recentProse,
    chapterSummaries,
    stickyGuidelines,
    stickyKnowledge,
    stickyCharacters,
    guidelineShortlist: nonStickyGuidelines,
    knowledgeShortlist: nonStickyKnowledge,
    characterShortlist: nonStickyCharacters,
    authorInput,
  }

  requestLogger.info('Context state built', {
    proseFragments: recentProse.length,
    stickyGuidelines: stickyGuidelines.length,
    stickyKnowledge: stickyKnowledge.length,
    stickyCharacters: stickyCharacters.length,
    guidelineShortlist: nonStickyGuidelines.length,
    knowledgeShortlist: nonStickyKnowledge.length,
    characterShortlist: nonStickyCharacters.length,
  })

  return state
}

export interface AssembleOptions {
  /** Extra tool descriptions to include in the context (e.g. plugin tools) */
  extraTools?: Array<{ name: string; description: string; pluginName?: string }>
}

/** Renders a single fragment with a source marker */
function renderFragment(f: Fragment): string {
  return `[@fragment=${f.id}]\n${registry.renderContext(f)}`
}

/**
 * Renders sticky fragments grouped by type into content parts.
 */
function renderTypeGrouped(fragments: Fragment[], label: string): string[] {
  if (fragments.length === 0) return []
  const parts: string[] = [`\n[@section=${label}]\n## ${label}`]
  for (const f of fragments) {
    parts.push(renderFragment(f))
  }
  return parts
}

/**
 * Renders sticky fragments in a custom order under a single heading.
 */
function renderAdvancedOrder(fragments: Fragment[], fragmentOrder: string[]): string[] {
  if (fragments.length === 0) return []

  // Build a map for quick lookup
  const fragMap = new Map(fragments.map(f => [f.id, f]))

  // Ordered fragments come first, then any not in the order list
  const ordered: Fragment[] = []
  const seen = new Set<string>()
  for (const id of fragmentOrder) {
    const f = fragMap.get(id)
    if (f) {
      ordered.push(f)
      seen.add(id)
    }
  }
  for (const f of fragments) {
    if (!seen.has(f.id)) {
      ordered.push(f)
    }
  }

  const parts: string[] = ['\n[@section=Context]\n## Context']
  for (const f of ordered) {
    parts.push(renderFragment(f))
  }
  return parts
}

/**
 * Creates the default context blocks from the context state.
 * Each section of the LLM prompt becomes a discrete, addressable block.
 * Blocks can be manipulated (find, replace, remove, insert, reorder) before compilation.
 */
export function createDefaultBlocks(state: ContextBuildState, opts: AssembleOptions = {}): ContextBlock[] {
  const {
    story,
    proseFragments,
    chapterSummaries,
    stickyGuidelines,
    stickyKnowledge,
    stickyCharacters,
    guidelineShortlist,
    knowledgeShortlist,
    characterShortlist,
    authorInput,
  } = state

  const contextOrderMode = story.settings.contextOrderMode ?? 'simple'
  const fragmentOrder = story.settings.fragmentOrder ?? []

  // Partition sticky fragments by placement
  const allSticky = [...stickyGuidelines, ...stickyKnowledge, ...stickyCharacters]
  const systemPlaced = allSticky.filter(f => (f.placement ?? 'user') === 'system')
  const userPlaced = allSticky.filter(f => (f.placement ?? 'user') === 'user')

  // Build tool lines (only for types with llmTools enabled)
  const toolLines: string[] = []
  const types = registry.listTypes()
  for (const t of types) {
    if (t.llmTools === false) continue
    const cap = t.type.charAt(0).toUpperCase() + t.type.slice(1)
    const plural = ['prose', 'knowledge'].includes(t.type) ? cap : cap + 's'
    toolLines.push(`- get${cap}(id): Get full content of a ${t.type} fragment`)
    toolLines.push(`- list${plural}(): List all ${t.type} fragments`)
  }
  toolLines.push('- listFragmentTypes(): List all available fragment types')
  if (opts.extraTools) {
    for (const t of opts.extraTools) {
      toolLines.push(`[@plugin=${t.pluginName ?? t.name}]\n- ${t.name}: ${t.description}`)
    }
  }

  const blocks: ContextBlock[] = []

  // --- System blocks ---

  blocks.push({
    id: 'instructions',
    role: 'system',
    content: [
      'You are a creative writing assistant. Your task is to write prose that continues the story based on the author\'s direction.',
      'IMPORTANT: Output the prose directly as your text response. Do NOT use tools to write or save prose — that is handled automatically.',
      'Only use tools to look up context you need before writing.',
    ].join('\n'),
    order: 100,
    source: 'builtin',
  })

  blocks.push({
    id: 'tools',
    role: 'system',
    content: [
      '## Available Tools',
      'You have access to the following tools:',
      toolLines.join('\n'),
      '\nUse these tools to retrieve details about characters, guidelines, or knowledge when needed. ' +
      'After gathering any context you need, output the prose directly as text. Do not explain what you are doing — just write the prose.',
    ].join('\n'),
    order: 200,
    source: 'builtin',
  })

  if (systemPlaced.length > 0) {
    let parts: string[]
    if (contextOrderMode === 'advanced') {
      parts = renderAdvancedOrder(systemPlaced, fragmentOrder)
    } else {
      parts = []
      const sysGuidelines = systemPlaced.filter(f => f.type === 'guideline')
      const sysKnowledge = systemPlaced.filter(f => f.type === 'knowledge')
      const sysCharacters = systemPlaced.filter(f => f.type === 'character')
      parts.push(...renderTypeGrouped(sysGuidelines, 'Guidelines'))
      parts.push(...renderTypeGrouped(sysKnowledge, 'Knowledge'))
      parts.push(...renderTypeGrouped(sysCharacters, 'Characters'))
    }
    blocks.push({
      id: 'system-fragments',
      role: 'system',
      content: parts.join('\n').replace(/^\n+/, ''),
      order: 300,
      source: 'builtin',
    })
  }

  // --- User blocks ---

  blocks.push({
    id: 'story-info',
    role: 'user',
    content: [
      `## Story: ${story.name}`,
      `${story.description}`,
    ].join('\n'),
    order: 100,
    source: 'builtin',
  })

  if (story.summary) {
    blocks.push({
      id: 'summary',
      role: 'user',
      content: `## Story Summary So Far\n${story.summary}`,
      order: 200,
      source: 'builtin',
    })
  }

  if (chapterSummaries.length > 0) {
    blocks.push({
      id: 'chapter-summaries',
      role: 'user',
      content: [
        '## Chapter/Arc Summaries',
        ...chapterSummaries.map((c) => `[@chapter=${c.markerId}]\n### ${c.name}\n${c.summary}`),
      ].join('\n\n'),
      order: 210,
      source: 'builtin',
    })
  }

  if (userPlaced.length > 0) {
    let parts: string[]
    if (contextOrderMode === 'advanced') {
      parts = renderAdvancedOrder(userPlaced, fragmentOrder)
    } else {
      parts = []
      const userGuidelines = userPlaced.filter(f => f.type === 'guideline')
      const userKnowledge = userPlaced.filter(f => f.type === 'knowledge')
      const userCharacters = userPlaced.filter(f => f.type === 'character')
      parts.push(...renderTypeGrouped(userGuidelines, 'Guidelines'))
      parts.push(...renderTypeGrouped(userKnowledge, 'Knowledge'))
      parts.push(...renderTypeGrouped(userCharacters, 'Characters'))
    }
    blocks.push({
      id: 'user-fragments',
      role: 'user',
      content: parts.join('\n').replace(/^\n+/, ''),
      order: 300,
      source: 'builtin',
    })
  }

  if (guidelineShortlist.length > 0) {
    blocks.push({
      id: 'shortlist-guidelines',
      role: 'user',
      content: [
        '## Available Guidelines use getFragment tool to retrieve full content',
        ...guidelineShortlist.map(g => `- ${g.id}: ${g.name} — ${g.description}`),
      ].join('\n'),
      order: 400,
      source: 'builtin',
    })
  }

  if (knowledgeShortlist.length > 0) {
    blocks.push({
      id: 'shortlist-knowledge',
      role: 'user',
      content: [
        '## Available Knowledge use getFragment tool to retrieve full content',
        ...knowledgeShortlist.map(k => `- ${k.id}: ${k.name} — ${k.description}`),
      ].join('\n'),
      order: 410,
      source: 'builtin',
    })
  }

  if (characterShortlist.length > 0) {
    blocks.push({
      id: 'shortlist-characters',
      role: 'user',
      content: [
        '## Available Characters  use getFragment tool to retrieve full content',
        ...characterShortlist.map(c => `- ${c.id}: ${c.name} — ${c.description}`),
      ].join('\n'),
      order: 420,
      source: 'builtin',
    })
  }

  if (proseFragments.length > 0) {
    blocks.push({
      id: 'prose',
      role: 'user',
      content: [
        '## Recent Prose',
        ...proseFragments.map(p => renderFragment(p)),
        '\n## End of Recent Prose',
      ].join('\n'),
      order: 500,
      source: 'builtin',
    })
  }

  blocks.push({
    id: 'author-input',
    role: 'user',
    content: `The author wants the following to happen next: ${authorInput}`,
    order: 600,
    source: 'builtin',
  })

  return blocks
}

/**
 * Renders a single block: prepends the [@block=id] marker to its content.
 */
function renderBlock(block: ContextBlock): string {
  return `[@block=${block.id}]\n${block.content}`
}

/**
 * Compiles context blocks into LLM messages.
 * Groups blocks by role, sorts by order, prepends [@block=id] markers,
 * and joins with blank-line separators.
 */
export function compileBlocks(blocks: ContextBlock[]): ContextMessage[] {
  const systemBlocks = blocks.filter(b => b.role === 'system').sort((a, b) => a.order - b.order)
  const userBlocks = blocks.filter(b => b.role === 'user').sort((a, b) => a.order - b.order)

  const messages: ContextMessage[] = []

  if (systemBlocks.length > 0) {
    messages.push({
      role: 'system',
      content: systemBlocks.map(renderBlock).join('\n\n'),
    })
  }

  if (userBlocks.length > 0) {
    messages.push({
      role: 'user',
      content: userBlocks.map(renderBlock).join('\n\n'),
    })
  }

  return messages
}

/**
 * Assembles the final LLM message array from the context state.
 * Thin wrapper over createDefaultBlocks + compileBlocks.
 */
export function assembleMessages(state: ContextBuildState, opts: AssembleOptions = {}): ContextMessage[] {
  const requestLogger = logger.child({ storyId: state.story.id })
  requestLogger.info('Assembling messages...')

  const blocks = createDefaultBlocks(state, opts)
  const messages = compileBlocks(blocks)

  requestLogger.info('Messages assembled', {
    messageCount: messages.length,
    systemContentLength: messages.find(m => m.role === 'system')?.content.length ?? 0,
    userContentLength: messages.find(m => m.role === 'user')?.content.length ?? 0,
  })

  return messages
}

/**
 * Builds the LLM message array from story fragments.
 * Convenience wrapper that calls buildContextState then assembleMessages.
 */
export async function buildContext(
  dataDir: string,
  storyId: string,
  authorInput: string,
  opts: BuildContextOptions = {},
): Promise<ContextMessage[]> {
  const state = await buildContextState(dataDir, storyId, authorInput, opts)
  return assembleMessages(state)
}
