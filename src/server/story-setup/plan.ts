import { generateText, tool } from 'ai'
import { z } from 'zod/v4'
import { generateFragmentId } from '@/lib/fragment-ids'
import { getModel, buildProviderOptions } from '../llm/client'
import { createFragment, getStory, listFragments, updateStory } from '../fragments/storage'
import { addProseSection } from '../fragments/prose-chain'
import type { Fragment } from '../fragments/schema'
import type { StorySetupDraftFragment } from './schema'

const StarterFragmentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(50),
  content: z.string().min(1),
})

export const StorySetupPlanSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  guideline: z.string().nullable(),
  knowledge: z.array(StarterFragmentSchema).max(8),
  characters: z.array(StarterFragmentSchema).max(8),
  opening: z.string().nullable(),
})

export type StorySetupPlan = z.infer<typeof StorySetupPlanSchema>

export interface StorySetupMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CreatedSetupFragment {
  id: string
  type: string
  name: string
}

function summarizeExistingFragments(fragments: Fragment[]): string {
  if (fragments.length === 0) return '(No fragments yet.)'
  return fragments
    .map(fragment => `- ${fragment.id} [${fragment.type}] ${fragment.name}: ${fragment.description}`)
    .join('\n')
}

export async function generateStorySetupPlan(
  dataDir: string,
  storyId: string,
  messages: StorySetupMessage[],
  draftFragments: StorySetupDraftFragment[] = [],
): Promise<StorySetupPlan> {
  const story = await getStory(dataDir, storyId)
  if (!story) throw new Error(`Story ${storyId} not found`)

  const existingFragments = await listFragments(dataDir, storyId)
  const resolvedModel = await getModel(dataDir, storyId, { role: 'story-setup.plan' })
  const { model, temperature } = resolvedModel
  const providerOptions = buildProviderOptions(story.settings.disableThinking ?? false, resolvedModel) as
    | Parameters<typeof generateText>[0]['providerOptions']
    | undefined

  const submitStorySetupPlan = tool({
    description: 'Submit the validated story setup plan for Errata to save.',
    inputSchema: StorySetupPlanSchema,
  })

  const result = await generateText({
    model,
    temperature,
    providerOptions,
    system: `Turn a story setup conversation into a small, useful starter set for Errata.

Stay grounded in the writer's answers. Resolve minor gaps conservatively, but do not invent major characters, world rules, or plot commitments the writer did not imply. Prefer fewer, richer fragments over exhaustive lists. Descriptions must be 50 characters or fewer.

The guideline should capture prose voice, viewpoint, tense, pacing, and relevant craft constraints. Use null only when the conversation gives no meaningful writing direction. Knowledge is for setting, rules, history, objects, or premise facts. Characters are for people or other story actors. Use an opening only if the conversation establishes a beginning or asks Errata to draft one; otherwise return null.

Do not recreate information already represented by an existing fragment unless the conversation explicitly asks to replace it.

Current story: ${story.name}
Current description: ${story.description || '(None)'}
Existing fragments:
${summarizeExistingFragments(existingFragments)}

Provisional fragments already shown to the writer:
${draftFragments.length > 0 ? JSON.stringify(draftFragments, null, 2) : '(None yet.)'}

Treat the provisional fragments as reviewed working material. Preserve their supported decisions and improve their completeness without silently changing their meaning.`,
    messages: [
      ...messages,
      {
        role: 'user',
        content: 'Create the validated starter plan now and submit it with the provided tool.',
      },
    ],
    tools: { submitStorySetupPlan },
    toolChoice: { type: 'tool', toolName: 'submitStorySetupPlan' },
  })

  const submission = result.toolCalls.find(call => call.toolName === 'submitStorySetupPlan')
  if (!submission) {
    throw new Error('The story setup model did not submit a plan.')
  }

  return StorySetupPlanSchema.parse(submission.input)
}

function makeFragment(
  type: 'guideline' | 'knowledge' | 'character' | 'prose',
  name: string,
  description: string,
  content: string,
  order: number,
): Fragment {
  const now = new Date().toISOString()
  return {
    id: generateFragmentId(type),
    type,
    name: name.slice(0, 100),
    description: description.slice(0, 50),
    content: content.trim(),
    tags: [],
    refs: [],
    sticky: type !== 'prose',
    placement: type === 'guideline' ? 'system' : 'user',
    createdAt: now,
    updatedAt: now,
    order,
    meta: {},
    archived: false,
    version: 1,
    versions: [],
  }
}

export async function applyStorySetupPlan(
  dataDir: string,
  storyId: string,
  plan: StorySetupPlan,
): Promise<{ created: CreatedSetupFragment[] }> {
  const story = await getStory(dataDir, storyId)
  if (!story) throw new Error(`Story ${storyId} not found`)

  await updateStory(dataDir, {
    ...story,
    name: plan.name.trim(),
    description: plan.description.trim(),
    updatedAt: new Date().toISOString(),
  })

  const existing = await listFragments(dataDir, storyId)
  let order = existing.reduce((max, fragment) => Math.max(max, fragment.order), -1) + 1
  const created: CreatedSetupFragment[] = []

  const persist = async (fragment: Fragment) => {
    await createFragment(dataDir, storyId, fragment)
    created.push({ id: fragment.id, type: fragment.type, name: fragment.name })
  }

  if (plan.guideline?.trim()) {
    await persist(makeFragment(
      'guideline',
      'Writing Guideline',
      'Core prose direction',
      plan.guideline,
      order++,
    ))
  }

  for (const item of plan.knowledge) {
    await persist(makeFragment('knowledge', item.name, item.description, item.content, order++))
  }

  for (const item of plan.characters) {
    await persist(makeFragment('character', item.name, item.description, item.content, order++))
  }

  if (plan.opening?.trim()) {
    const opening = makeFragment('prose', 'Opening', 'Story opening', plan.opening, order++)
    await persist(opening)
    await addProseSection(dataDir, storyId, opening.id)
  }

  return { created }
}
