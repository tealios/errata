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
 * Builds the LLM message array from story fragments.
 * System message contains: story info, prose chain, sticky fragments, shortlists, tool hints.
 * User message contains: the author's input/direction.
 */
export async function buildContext(
  dataDir: string,
  storyId: string,
  authorInput: string,
  proseLimit: number = DEFAULT_PROSE_LIMIT,
): Promise<ContextMessage[]> {
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

  // Build system message
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
  if (nonStickyGuidelines.length > 0) {
    systemParts.push('\n## Available Guidelines (use fragmentGet to retrieve)')
    for (const g of nonStickyGuidelines) {
      systemParts.push(`- ${g.id}: ${g.name} — ${g.description}`)
    }
  }

  // Shortlists for non-sticky knowledge
  if (nonStickyKnowledge.length > 0) {
    systemParts.push('\n## Available Knowledge (use fragmentGet to retrieve)')
    for (const k of nonStickyKnowledge) {
      systemParts.push(`- ${k.id}: ${k.name} — ${k.description}`)
    }
  }

  // Prose chain
  if (recentProse.length > 0) {
    systemParts.push('\n## Recent Prose')
    for (const p of recentProse) {
      systemParts.push(registry.renderContext(p))
    }
  }

  // Tool availability note
  systemParts.push(
    '\n## Available Tools\n' +
      'You have access to fragment tools to look up additional context:\n' +
      '- fragmentGet: Retrieve the full content of any fragment by ID\n' +
      '- fragmentList: List all fragments of a given type (returns id, name, description)\n' +
      '- fragmentTypesList: List all available fragment types\n' +
      '\nUse these tools to retrieve details about characters, guidelines, or knowledge when needed.',
  )

  const systemContent = systemParts.join('\n')

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: authorInput },
  ]
}
