import type { ContextBlock } from '../llm/context-builder'
import type { AgentBlockContext } from '../agents/agent-block-context'
import { getFragment } from '../fragments/storage'
import { getFragmentsByTag } from '../fragments/associations'
import {
  instructionsBlock,
  systemFragmentsBlock,
  buildBasePreviewContext,
  loadSystemPromptFragments,
} from '../agents/block-helpers'

export const DIRECTIONS_SYSTEM_PROMPT = `You are a creative writing assistant that suggests possible story directions. Given the full story context, propose distinct and compelling directions the narrative could take. Each suggestion should have a short evocative title, a brief description, and a detailed instruction prompt suitable for a writer.`

export function createDirectionsSuggestBlocks(ctx: AgentBlockContext): ContextBlock[] {
  const blocks: ContextBlock[] = []

  blocks.push(instructionsBlock('directions.system', ctx))

  const sysFrags = systemFragmentsBlock(ctx)
  if (sysFrags) blocks.push(sysFrags)

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
  const base = await buildBasePreviewContext(dataDir, storyId)
  const systemPromptFragments = await loadSystemPromptFragments(dataDir, storyId, getFragmentsByTag, getFragment)
  return { ...base, systemPromptFragments }
}
