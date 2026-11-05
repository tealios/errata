import { z } from 'zod/v4'

export const StorySetupChecklistKeySchema = z.enum([
  'starting-point',
  'premise',
  'characters',
  'goal',
  'setting',
  'voice',
  'opening',
])

export const StorySetupChecklistItemSchema = z.object({
  key: StorySetupChecklistKeySchema,
  status: z.enum(['missing', 'partial', 'covered']),
  note: z.string().max(120),
})

/** Matches the app-wide fragment description limit (see fragments/schema.ts). */
export const STORY_SETUP_DESCRIPTION_MAX = 250

/** Upper bound on fragments one setup conversation manages. Generous on purpose:
 *  the snapshot is the complete set, so a tight cap bricks the tool once reached. */
export const STORY_SETUP_FRAGMENT_MAX = 100

export const StorySetupDraftFragmentSchema = z.object({
  key: z.string().min(1).max(50).regex(/^[a-z0-9][a-z0-9-]*$/),
  type: z.enum(['guideline', 'knowledge', 'character', 'prose']),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(STORY_SETUP_DESCRIPTION_MAX),
  content: z.string().min(1).optional().describe(
    'Full fragment text. Required for a new fragment. Omit it for a fragment that already exists and whose content is unchanged.',
  ),
})

export const StorySetupSnapshotSchema = z.object({
  story: z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500),
  }).nullable(),
  checklist: z.array(StorySetupChecklistItemSchema).length(7),
  fragments: z.array(StorySetupDraftFragmentSchema).max(STORY_SETUP_FRAGMENT_MAX),
})

export type StorySetupDraftFragment = z.infer<typeof StorySetupDraftFragmentSchema>
