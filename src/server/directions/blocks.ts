import type { ContextBlock } from '../llm/context-builder'
import type { AgentBlockContext } from '../agents/agent-block-context'
import { buildContextState } from '../llm/context-builder'
import { getStory, getFragment } from '../fragments/storage'
import { getFragmentsByTag } from '../fragments/associations'

const DIRECTIONS_SYSTEM_PROMPT = `You are a creative writing assistant that suggests possible story directions. Given the full story context, propose distinct and compelling directions the narrative could take. Each suggestion should have a short evocative title, a brief description, and a detailed instruction prompt suitable for a writer.`

export function createDirectionsSuggestBlocks(ctx: AgentBlockContext): ContextBlock[] {
  const blocks: ContextBlock[] = []

  blocks.push({
    id: 'instructions',
    role: 'system',
    content: DIRECTIONS_SYSTEM_PROMPT.trim(),
    order: 100,
    source: 'builtin',
  })

  if (ctx.systemPromptFragments.length > 0) {
    blocks.push({
      id: 'system-fragments',
      role: 'system',
      content: ctx.systemPromptFragments.map(frag => `## ${frag.name}\n${frag.content}`).join('\n\n'),
      order: 200,
      source: 'builtin',
    })
  }

  blocks.push({
    id: 'story-summary',
    role: 'user',
    content: `## Story Summary\n${ctx.story.summary || '(No summary yet.)'}`,
    order: 100,
    source: 'builtin',
  })

  if (ctx.stickyCharacters.length > 0 || ctx.characterShortlist.length > 0) {
    const chars = [...ctx.stickyCharacters, ...ctx.characterShortlist]
    const unique = chars.filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)
    if (unique.length > 0) {
      blocks.push({
        id: 'characters',
        role: 'user',
        content: `## Characters\n${unique.map(c => `### ${c.name}\n${c.content}`).join('\n\n')}`,
        order: 200,
        source: 'builtin',
      })
    }
  }

  if (ctx.proseFragments.length > 0) {
    const recentProse = ctx.proseFragments.slice(-3)
    blocks.push({
      id: 'recent-prose',
      role: 'user',
      content: `## Recent Prose\n${recentProse.map(f => f.content).join('\n\n---\n\n')}`,
      order: 300,
      source: 'builtin',
    })
  }

  return blocks
}

export async function buildDirectionsPreviewContext(dataDir: string, storyId: string): Promise<AgentBlockContext> {
  const ctxState = await buildContextState(dataDir, storyId, '')
  const story = await getStory(dataDir, storyId)

  const sysFragIds = await getFragmentsByTag(dataDir, storyId, 'pass-to-librarian-system-prompt')
  const systemPromptFragments = []
  for (const id of sysFragIds) {
    const frag = await getFragment(dataDir, storyId, id)
    if (frag) systemPromptFragments.push(frag)
  }

  return {
    story: story!,
    proseFragments: ctxState.proseFragments,
    stickyGuidelines: ctxState.stickyGuidelines,
    stickyKnowledge: ctxState.stickyKnowledge,
    stickyCharacters: ctxState.stickyCharacters,
    guidelineShortlist: ctxState.guidelineShortlist,
    knowledgeShortlist: ctxState.knowledgeShortlist,
    characterShortlist: ctxState.characterShortlist,
    systemPromptFragments,
  }
}
