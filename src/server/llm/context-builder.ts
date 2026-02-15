import { getStory, listFragments, getFragment } from '../fragments/storage'
import { registry } from '../fragments/registry'
import { createLogger } from '../logging'
import { getActiveProseIds, findSectionIndex } from '../fragments/prose-chain'
import { listAnalyses, getAnalysis } from '../librarian/storage'
import type { Fragment, StoryMeta } from '../fragments/schema'

export interface ContextBuildState {
  story: StoryMeta
  proseFragments: Fragment[]
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

const DEFAULT_PROSE_LIMIT = 10
const logger = createLogger('context-builder')

export interface BuildContextOptions {
  proseLimit?: number
  /** Fragment ID to exclude from context (e.g., when regenerating) */
  excludeFragmentId?: string
  /** Only include prose that comes before this fragment in the active prose chain */
  proseBeforeFragmentId?: string
  /** Build summary only from librarian updates before this fragment */
  summaryBeforeFragmentId?: string
  /** Exclude story summary from context */
  excludeStorySummary?: boolean
}

async function buildSummaryBeforeFragment(
  dataDir: string,
  storyId: string,
  fragmentIdsInOrder: string[],
): Promise<string> {
  if (fragmentIdsInOrder.length === 0) return ''

  const summaries = await listAnalyses(dataDir, storyId)
  if (summaries.length === 0) return ''

  const analyses = await Promise.all(
    summaries.map((s) => getAnalysis(dataDir, storyId, s.id)),
  )

  const position = new Map(fragmentIdsInOrder.map((id, idx) => [id, idx]))
  const updates = analyses
    .filter((a): a is NonNullable<typeof a> => !!a)
    .filter((a) => position.has(a.fragmentId))
    .filter((a) => a.summaryUpdate.trim().length > 0)
    .sort((a, b) => (position.get(a.fragmentId) ?? 0) - (position.get(b.fragmentId) ?? 0))
    .map((a) => a.summaryUpdate.trim())

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
    proseLimit = DEFAULT_PROSE_LIMIT,
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
      if (fragment && !fragment.archived) {
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

  // Take only the last N prose fragments
  const recentProse = sortedProse.slice(-proseLimit)

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
  extraTools?: Array<{ name: string; description: string }>
}

/**
 * Renders sticky fragments grouped by type into content parts.
 */
function renderTypeGrouped(fragments: Fragment[], label: string): string[] {
  if (fragments.length === 0) return []
  const parts: string[] = [`\n## ${label}`]
  for (const f of fragments) {
    parts.push(registry.renderContext(f))
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

  const parts: string[] = ['\n## Context']
  for (const f of ordered) {
    parts.push(registry.renderContext(f))
  }
  return parts
}

/**
 * Assembles the final LLM message array from the context state.
 * This is the second step — called after hook modifications.
 */
export function assembleMessages(state: ContextBuildState, opts: AssembleOptions = {}): ContextMessage[] {
  const requestLogger = logger.child({ storyId: state.story.id })
  requestLogger.info('Assembling messages...')

  const {
    story,
    proseFragments,
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
      toolLines.push(`- ${t.name}: ${t.description}`)
    }
  }

  // Shortlists (always go in user message)
  const shortlistParts: string[] = []
  if (guidelineShortlist.length > 0) {
    shortlistParts.push('\n## Available Guidelines')
    for (const g of guidelineShortlist) {
      shortlistParts.push(`- ${g.id}: ${g.name} — ${g.description}`)
    }
  }
  if (knowledgeShortlist.length > 0) {
    shortlistParts.push('\n## Available Knowledge')
    for (const k of knowledgeShortlist) {
      shortlistParts.push(`- ${k.id}: ${k.name} — ${k.description}`)
    }
  }
  if (characterShortlist.length > 0) {
    shortlistParts.push('\n## Available Characters')
    for (const c of characterShortlist) {
      shortlistParts.push(`- ${c.id}: ${c.name} — ${c.description}`)
    }
  }

  // Build system message — always present with instructions, optionally with system-placed fragments
  const sysParts: string[] = []

  sysParts.push(
    'You are a creative writing assistant. Your task is to write prose that continues the story based on the author\'s direction.',
    'IMPORTANT: Output the prose directly as your text response. Do NOT use tools to write or save prose — that is handled automatically.',
    'Only use tools to look up context you need before writing.',
  )

  // Available tools listed in system prompt
  sysParts.push('\n## Available Tools')
  sysParts.push('You have access to the following tools:')
  sysParts.push(toolLines.join('\n'))
  sysParts.push(
    '\nUse these tools to retrieve details about characters, guidelines, or knowledge when needed. ' +
    'After gathering any context you need, output the prose directly as text. Do not explain what you are doing — just write the prose.'
  )

  // System-placed fragments
  if (systemPlaced.length > 0) {
    if (contextOrderMode === 'advanced') {
      sysParts.push(...renderAdvancedOrder(systemPlaced, fragmentOrder))
    } else {
      // Simple mode: group by type
      const sysGuidelines = systemPlaced.filter(f => f.type === 'guideline')
      const sysKnowledge = systemPlaced.filter(f => f.type === 'knowledge')
      const sysCharacters = systemPlaced.filter(f => f.type === 'character')
      sysParts.push(...renderTypeGrouped(sysGuidelines, 'Guidelines'))
      sysParts.push(...renderTypeGrouped(sysKnowledge, 'Knowledge'))
      sysParts.push(...renderTypeGrouped(sysCharacters, 'Characters'))
    }
  }

  const systemMessageContent = sysParts.join('\n')

  // Build user message content
  const userParts: string[] = []

  // Story info
  userParts.push(`## Story: ${story.name}`)
  userParts.push(`${story.description}`)
  if (story.summary) {
    userParts.push(`\n## Story Summary So Far\n${story.summary}`)
  }

  // User-placed sticky fragments
  if (contextOrderMode === 'advanced') {
    userParts.push(...renderAdvancedOrder(userPlaced, fragmentOrder))
  } else {
    // Simple mode: group by type
    const userGuidelines = userPlaced.filter(f => f.type === 'guideline')
    const userKnowledge = userPlaced.filter(f => f.type === 'knowledge')
    const userCharacters = userPlaced.filter(f => f.type === 'character')
    userParts.push(...renderTypeGrouped(userGuidelines, 'Guidelines'))
    userParts.push(...renderTypeGrouped(userKnowledge, 'Knowledge'))
    userParts.push(...renderTypeGrouped(userCharacters, 'Characters'))
  }

  // Shortlists
  userParts.push(...shortlistParts)

  // Prose chain
  if (proseFragments.length > 0) {
    userParts.push('\n## Recent Prose')
    for (const p of proseFragments) {
      userParts.push(registry.renderContext(p))
    }
    userParts.push('\n## End of Recent Prose')
  }

  // Author input
  userParts.push('\nThe author wants the following to happen next: ' + authorInput)

  const userContent = userParts.join('\n')

  const messages: ContextMessage[] = [
    { role: 'system', content: systemMessageContent },
    { role: 'user', content: userContent },
  ]

  requestLogger.info('Messages assembled', {
    messageCount: messages.length,
    systemContentLength: systemMessageContent.length,
    userContentLength: userContent.length,
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
