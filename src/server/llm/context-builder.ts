import { getStory, listFragments } from '../fragments/storage'
import { registry } from '../fragments/registry'
import type { Fragment, StoryMeta } from '../fragments/schema'

export interface ContextBuildState {
  story: StoryMeta
  proseFragments: Fragment[]
  stickyGuidelines: Fragment[]
  stickyKnowledge: Fragment[]
  guidelineShortlist: Fragment[]
  knowledgeShortlist: Fragment[]
  authorInput: string
}

export interface ContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const DEFAULT_PROSE_LIMIT = 10

/**
 * Loads fragments and builds the intermediate state for context assembly.
 * This is the first step — hooks can modify this state before message assembly.
 */
export async function buildContextState(
  dataDir: string,
  storyId: string,
  authorInput: string,
  proseLimit: number = DEFAULT_PROSE_LIMIT,
): Promise<ContextBuildState> {
  const story = await getStory(dataDir, storyId)
  if (!story) {
    throw new Error(`Story not found: ${storyId}`)
  }

  // Load all fragments by type
  const allProse = await listFragments(dataDir, storyId, 'prose')
  const allGuidelines = await listFragments(dataDir, storyId, 'guideline')
  const allKnowledge = await listFragments(dataDir, storyId, 'knowledge')

  // Sort prose by order, then createdAt
  const sortedProse = allProse.sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
  )

  // Take only the last N prose fragments
  const recentProse = sortedProse.slice(-proseLimit)

  // Split guidelines and knowledge into sticky (full) vs shortlist
  const stickyGuidelines = allGuidelines.filter((f) => f.sticky)
  const nonStickyGuidelines = allGuidelines.filter((f) => !f.sticky)
  const stickyKnowledge = allKnowledge.filter((f) => f.sticky)
  const nonStickyKnowledge = allKnowledge.filter((f) => !f.sticky)

  return {
    story,
    proseFragments: recentProse,
    stickyGuidelines,
    stickyKnowledge,
    guidelineShortlist: nonStickyGuidelines,
    knowledgeShortlist: nonStickyKnowledge,
    authorInput,
  }
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
  const {
    story,
    proseFragments,
    stickyGuidelines,
    stickyKnowledge,
    guidelineShortlist,
    knowledgeShortlist,
    authorInput,
  } = state

  const systemParts: string[] = []

  // Story info
  systemParts.push(`# Story: ${story.name}`)
  systemParts.push(`${story.description}`)
  if (story.summary) {
    systemParts.push(`\n## Story Summary So Far\n${story.summary}`)
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

  // Prose chain
  if (proseFragments.length > 0) {
    systemParts.push('\n## Recent Prose')
    for (const p of proseFragments) {
      systemParts.push(registry.renderContext(p))
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

  return [
    { role: 'user', content: systemContent },
  ]
}

/**
 * Builds the LLM message array from story fragments.
 * Convenience wrapper that calls buildContextState then assembleMessages.
 */
export async function buildContext(
  dataDir: string,
  storyId: string,
  authorInput: string,
  proseLimit: number = DEFAULT_PROSE_LIMIT,
): Promise<ContextMessage[]> {
  const state = await buildContextState(dataDir, storyId, authorInput, proseLimit)
  return assembleMessages(state)
}
