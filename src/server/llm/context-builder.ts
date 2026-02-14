import { getStory, listFragments, getFragment } from '../fragments/storage'
import { registry } from '../fragments/registry'
import { createLogger } from '../logging'
import { getActiveProseIds } from '../fragments/prose-chain'
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
  const { proseLimit = DEFAULT_PROSE_LIMIT, excludeFragmentId } = opts
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
    // Filter out excluded fragment
    if (excludeFragmentId) {
      proseFragments = proseFragments.filter(f => f.id !== excludeFragmentId)
    }
  } else {
    requestLogger.debug('Prose chain loaded', { activeProseCount: activeProseIds.length })
    // Load the actual prose fragments from chain, excluding the specified fragment
    for (const proseId of activeProseIds) {
      // Skip the excluded fragment
      if (excludeFragmentId && proseId === excludeFragmentId) {
        requestLogger.debug('Excluding fragment from context', { excludedId: excludeFragmentId })
        continue
      }
      const fragment = await getFragment(dataDir, storyId, proseId)
      if (fragment) {
        proseFragments.push(fragment)
      } else {
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

  // Split guidelines, knowledge, and characters into sticky (full) vs shortlist
  const stickyGuidelines = allGuidelines.filter((f) => f.sticky)
  const nonStickyGuidelines = allGuidelines.filter((f) => !f.sticky)
  const stickyKnowledge = allKnowledge.filter((f) => f.sticky)
  const nonStickyKnowledge = allKnowledge.filter((f) => !f.sticky)
  const stickyCharacters = allCharacters.filter((f) => f.sticky)
  const nonStickyCharacters = allCharacters.filter((f) => !f.sticky)

  const state = {
    story,
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

  const systemParts: string[] = []

  // Story info
  systemParts.push(`## Story: ${story.name}`)
  systemParts.push(`${story.description}`)
  if (story.summary) {
    systemParts.push(`\n## Story Summary So Far\n${story.summary}`)
  }

  // Prose chain
  if (proseFragments.length > 0) {
    systemParts.push('\n## Recent Prose')
    for (const p of proseFragments) {
      systemParts.push(registry.renderContext(p))
    }
  }

  // Sticky guidelines (full content)
  if (stickyGuidelines.length > 0) {
    systemParts.push('\n## Guidelines')
    for (const g of stickyGuidelines) {
      systemParts.push(registry.renderContext(g))
    }
  }

  // Sticky knowledge (full content)
  if (stickyKnowledge.length > 0) {
    systemParts.push('\n## Knowledge')
    for (const k of stickyKnowledge) {
      systemParts.push(registry.renderContext(k))
    }
  }

  // Sticky characters (full content)
  if (stickyCharacters.length > 0) {
    systemParts.push('\n## Characters')
    for (const c of stickyCharacters) {
      systemParts.push(registry.renderContext(c))
    }
  }

  // Shortlists for non-sticky guidelines
  if (guidelineShortlist.length > 0) {
    systemParts.push('\n## Available Guidelines (use getGuideline(id) to retrieve)')
    for (const g of guidelineShortlist) {
      systemParts.push(`- ${g.id}: ${g.name} — ${g.description}`)
    }
  }

  // Shortlists for non-sticky knowledge
  if (knowledgeShortlist.length > 0) {
    systemParts.push('\n## Available Knowledge (use getKnowledge(id) to retrieve)')
    for (const k of knowledgeShortlist) {
      systemParts.push(`- ${k.id}: ${k.name} — ${k.description}`)
    }
  }

  // Shortlists for non-sticky characters
  if (characterShortlist.length > 0) {
    systemParts.push('\n## Available Characters (use getCharacter(id) to retrieve)')
    for (const c of characterShortlist) {
      systemParts.push(`- ${c.id}: ${c.name} — ${c.description}`)
    }
  }

  // Instructions + tool availability note
  const toolLines: string[] = []
  const types = registry.listTypes()
  for (const t of types) {
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

  systemParts.push(
    '\n## Instructions\n' +
      'You are a creative writing assistant. Your task is to write prose that continues the story based on the author\'s direction.\n' +
      'IMPORTANT: Output the prose directly as your text response. Do NOT use tools to write or save prose — that is handled automatically.\n' +
      'Only use tools to look up context you need before writing.\n' +
      '\n## Available Tools\n' +
      'You have access to the following tools:\n' +
      toolLines.join('\n') +
      '\n\nUse these tools to retrieve details about characters, guidelines, or knowledge when needed. ' +
      'After gathering any context you need, output the prose directly as text. Do not explain what you are doing — just write the prose.',
      '\nThe author wants the following to happen next: ' + authorInput
  )

  const systemContent = systemParts.join('\n')

  const messages: ContextMessage[] = [
    { role: 'user', content: systemContent },
  ]

  requestLogger.info('Messages assembled', { 
    messageCount: messages.length, 
    systemContentLength: systemContent.length 
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
