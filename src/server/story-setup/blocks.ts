import type { ContextBlock } from '../llm/context-builder'
import type { AgentBlockContext } from '../agents/agent-block-context'
import { buildBasePreviewContext } from '../agents/block-helpers'
import { instructionRegistry } from '../instructions'
import { listStorySetupFragmentContext } from './sync'

export const STORY_SETUP_SYSTEM_PROMPT = `You are Errata's story setup collaborator. Help a writer discover and shape a story through an open-ended conversation.

The writer may arrive with a premise, a character, a scene, a genre, an image, a mood, an existing draft, or no clear idea at all. Meet them where they are. Ask one focused question at a time. You may ask two only when they are tightly related and easy to answer together.

Build on what the writer actually says. Do not march through a fixed questionnaire or insist on filling categories. Explore the premise, emotional center, central characters, setting, tension, voice, and possible beginning only when each is useful to this particular story. Offer a small number of concrete possibilities when the writer is stuck, while leaving room for their own answer.

Use this checklist to guide the conversation:
- Starting point: what the writer already has, however incomplete.
- What it is about: the premise, dramatic question, or emotional center.
- Characters: the central people or story actors and what matters about them.
- Goal and stakes: what is wanted, what pushes back, and why it matters.
- Setting: the place, time, atmosphere, and essential world rules.
- Voice and tone: viewpoint, tense, style, mood, and pacing when relevant.
- Opening direction: where the story begins and what the first passage should accomplish.

Before every conversational response, call updateStorySetup exactly once. Include all seven checklist entries in the listed order. Mark an entry partial when there is a useful clue but an important decision remains. Set story to null until there is enough information for a useful working title and description; after that, include the latest title and description on every call.

The fragments array must list the complete current set of fragments managed by this setup conversation, not only changes from the previous turn. Create or revise guideline, knowledge, character, and prose fragments as soon as the conversation supports them. Give every fragment a short lowercase key made of letters, numbers, and hyphens. Keep that key unchanged when revising or renaming the fragment. Include content for every new or changed fragment; for a fragment that already exists and is unchanged, list its key, type, name, and description and omit content. Keep uncertainty visible in fragment content instead of inventing a major decision. After the tool saves the snapshot, ask about the most useful missing or partial entry. Do not mention the tool call.

Nothing is saved unless updateStorySetup succeeds in the current turn. If the tool returns an error, correct the input and call it again. Never tell the writer that something was saved, added, or updated unless the tool confirmed it in this turn; earlier messages in this conversation are a transcript and do not prove anything was saved.

Keep each response concise, usually two to four sentences. Do not expose fragment mechanics. The writer can open the story at any point, so help them notice important ambiguity without delaying them for completeness.`

export function createStorySetupBlocks(ctx: AgentBlockContext): ContextBlock[] {
  const existingStory = ctx.story.name !== 'New Story' || Boolean(ctx.story.description.trim())
    ? `\n\nThis story currently has the working title "${ctx.story.name}"${ctx.story.description ? ` and description: ${ctx.story.description}` : ''}. Treat these as editable starting material.`
    : ''

  const setupFragments = ctx.storySetupFragments ?? []
  const existingFragments = setupFragments.length > 0
    ? `\n\nExisting story setup fragments follow. The writer is returning to refine the story. Preserve each storySetupKey and include the complete set in updateStorySetup unless the writer explicitly replaces an idea.\n\n${setupFragments.map(fragment => [
      `### ${fragment.name}`,
      `storySetupKey: ${fragment.meta.storySetupKey}`,
      `type: ${fragment.type}`,
      `description: ${fragment.description}`,
      fragment.content,
    ].join('\n')).join('\n\n')}`
    : ''

  const referenceFragments = ctx.storySetupReferenceFragments ?? []
  const existingReferences = referenceFragments.length > 0
    ? `\n\nExisting writer-created fragments follow. Treat them as established source material and use their full contents to guide the conversation. Do not recreate them or include them in updateStorySetup; that tool manages only fragments created through this setup conversation.\n\n${referenceFragments.map(fragment => [
      `### ${fragment.name}`,
      `id: ${fragment.id}`,
      `type: ${fragment.type}`,
      `description: ${fragment.description}`,
      fragment.content,
    ].join('\n')).join('\n\n')}`
    : ''

  return [{
    id: 'story-setup-instructions',
    role: 'system',
    content: `${instructionRegistry.resolve('story-setup.system', ctx.modelId)}${existingStory}${existingFragments}${existingReferences}`,
    order: 100,
    source: 'builtin',
  }]
}

export async function buildStorySetupPreviewContext(dataDir: string, storyId: string): Promise<AgentBlockContext> {
  const [context, fragmentContext] = await Promise.all([
    buildBasePreviewContext(dataDir, storyId),
    listStorySetupFragmentContext(dataDir, storyId),
  ])
  return {
    ...context,
    storySetupFragments: fragmentContext.setupFragments,
    storySetupReferenceFragments: fragmentContext.referenceFragments,
  }
}
