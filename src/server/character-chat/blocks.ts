import type { ContextBlock } from '../llm/context-builder'
import type { AgentBlockContext } from '../agents/agent-block-context'
import { instructionRegistry } from '../instructions'
import { buildBasePreviewContext } from '../agents/block-helpers'

export function createCharacterChatBlocks(ctx: AgentBlockContext): ContextBlock[] {
  const blocks: ContextBlock[] = []

  if (ctx.character) {
    const systemTemplate = instructionRegistry.resolve('character-chat.system', ctx.modelId)
    blocks.push({
      id: 'character',
      role: 'system',
      content: [
        systemTemplate.replace(/\{\{characterName\}\}/g, ctx.character.name),
        '',
        '## Character Details',
        ctx.character.content,
        '',
        '## Character Description',
        ctx.character.description,
      ].join('\n'),
      order: 100,
      source: 'builtin',
    })
  }

  if (ctx.personaDescription) {
    blocks.push({
      id: 'persona',
      role: 'system',
      content: [
        '## Who You Are Speaking With',
        ctx.personaDescription,
      ].join('\n'),
      order: 200,
      source: 'builtin',
    })
  }

  // Story context + instructions
  const storyContextParts: string[] = []
  storyContextParts.push(`## Story: ${ctx.story.name}`)
  storyContextParts.push(ctx.story.description)
  if (ctx.story.summary) {
    storyContextParts.push(`\n## Story Summary\n${ctx.story.summary}`)
  }

  // Prose summaries (inline — character chat bundles everything into one block)
  if (ctx.proseFragments.length > 0) {
    storyContextParts.push('\n## Story Events (use getFragment to read full prose)')
    for (const p of ctx.proseFragments) {
      if ((p.meta._librarian as { summary?: string })?.summary) {
        storyContextParts.push(`- ${p.id}: ${(p.meta._librarian as { summary?: string }).summary}`)
      } else if (p.content.length < 600) {
        storyContextParts.push(`- ${p.id}: \n${p.content}`)
      } else {
        storyContextParts.push(`- ${p.id}: ${p.content.slice(0, 500).replace(/\n/g, ' ')}... [truncated]`)
      }
    }
  }

  // Sticky fragments
  const stickyAll = [
    ...ctx.stickyGuidelines,
    ...ctx.stickyKnowledge,
    ...ctx.stickyCharacters,
  ]
  if (stickyAll.length > 0) {
    storyContextParts.push('\n## World Context')
    for (const f of stickyAll) {
      storyContextParts.push(`- ${f.id}: ${f.name} — ${f.description}`)
    }
  }

  const characterName = ctx.character?.name ?? 'the character'
  const instructionsTemplate = instructionRegistry.resolve('character-chat.instructions', ctx.modelId)

  blocks.push({
    id: 'story-context',
    role: 'system',
    content: [
      '## Story Context',
      storyContextParts.join('\n'),
      '',
      '## Instructions',
      instructionsTemplate.replace(/\{\{characterName\}\}/g, characterName),
    ].join('\n'),
    order: 300,
    source: 'builtin',
  })

  return blocks
}

export async function buildCharacterChatPreviewContext(dataDir: string, storyId: string): Promise<AgentBlockContext> {
  const base = await buildBasePreviewContext(dataDir, storyId)
  return {
    ...base,
    character: undefined,
    personaDescription: 'You are speaking with a stranger you have just met. You do not know who they are.',
  }
}
