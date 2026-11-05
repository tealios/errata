import { generateFragmentId } from '@/lib/fragment-ids'
import { withKeyLock } from '../async-lock'
import {
  createFragment,
  getStory,
  listFragments,
  updateFragmentVersioned,
  updateStory,
} from '../fragments/storage'
import { addProseSection } from '../fragments/prose-chain'
import type { Fragment } from '../fragments/schema'
import type { StorySetupDraftFragment } from './schema'

interface SetupStoryDraft {
  name: string
  description: string
}

export interface StorySetupSyncInput {
  story: SetupStoryDraft | null
  fragments: StorySetupDraftFragment[]
}

export interface PersistedStorySetupFragment extends StorySetupDraftFragment {
  id: string
  content: string
}

export async function listStorySetupFragmentContext(
  dataDir: string,
  storyId: string,
): Promise<{ setupFragments: Fragment[]; referenceFragments: Fragment[] }> {
  const fragments = await listFragments(dataDir, storyId)
  const setupFragments: Fragment[] = []
  const referenceFragments: Fragment[] = []

  for (const fragment of fragments) {
    if (typeof fragment.meta.storySetupKey === 'string') {
      setupFragments.push(fragment)
    } else if (['guideline', 'knowledge', 'character'].includes(fragment.type)) {
      referenceFragments.push(fragment)
    }
  }

  return {
    setupFragments: setupFragments.sort((a, b) => a.order - b.order),
    referenceFragments: referenceFragments.sort((a, b) => a.order - b.order),
  }
}

function makeSetupFragment(draft: StorySetupDraftFragment & { content: string }, order: number): Fragment {
  const now = new Date().toISOString()
  return {
    id: generateFragmentId(draft.type),
    type: draft.type,
    name: draft.name,
    description: draft.description,
    content: draft.content.trim(),
    tags: [],
    refs: [],
    sticky: draft.type !== 'prose',
    placement: draft.type === 'guideline' ? 'system' : 'user',
    createdAt: now,
    updatedAt: now,
    order,
    meta: { storySetupKey: draft.key },
    archived: false,
    version: 1,
    versions: [],
  }
}

function toPersisted(fragment: Fragment): PersistedStorySetupFragment {
  return {
    id: fragment.id,
    key: fragment.meta.storySetupKey as string,
    type: fragment.type as StorySetupDraftFragment['type'],
    name: fragment.name,
    description: fragment.description,
    content: fragment.content,
  }
}

/**
 * Persist the model's latest setup snapshot without touching writer-owned fragments.
 *
 * A draft may omit `content` when the fragment already exists; the stored content
 * is kept. Setup fragments missing from the snapshot are never deleted. The
 * returned set is the complete, actual set of setup fragments on disk, so callers
 * can show the truth rather than what the model happened to resend.
 */
export async function syncStorySetupSnapshot(
  dataDir: string,
  storyId: string,
  input: StorySetupSyncInput,
): Promise<{ story: SetupStoryDraft | null; fragments: PersistedStorySetupFragment[] }> {
  return withKeyLock(`story-setup:${storyId}`, async () => {
    const story = await getStory(dataDir, storyId)
    if (!story) throw new Error(`Story ${storyId} not found`)

    if (input.story) {
      await updateStory(dataDir, {
        ...story,
        name: input.story.name.trim(),
        description: input.story.description.trim(),
        updatedAt: new Date().toISOString(),
      })
    }

    const existing = await listFragments(dataDir, storyId)
    const setupByKey = new Map(
      existing
        .filter(fragment => typeof fragment.meta.storySetupKey === 'string')
        .map(fragment => [fragment.meta.storySetupKey as string, fragment]),
    )
    let order = existing.reduce((max, fragment) => Math.max(max, fragment.order), -1) + 1

    // Validate the whole snapshot before writing anything, so a bad entry
    // doesn't leave half the set saved.
    for (const draft of input.fragments) {
      const current = setupByKey.get(draft.key)
      if (current && current.type !== draft.type) {
        throw new Error(`Story setup fragment "${draft.key}" cannot change type from ${current.type} to ${draft.type}`)
      }
      if (!current && !draft.content?.trim()) {
        throw new Error(`Story setup fragment "${draft.key}" is new and needs content`)
      }
    }

    for (const draft of input.fragments) {
      const current = setupByKey.get(draft.key)
      if (current) {
        const content = draft.content?.trim()
        const updated = await updateFragmentVersioned(dataDir, storyId, current.id, {
          name: draft.name,
          description: draft.description,
          ...(content ? { content } : {}),
        }, { reason: 'story-setup' })
        if (!updated) throw new Error(`Story setup fragment ${current.id} disappeared during update`)
        setupByKey.set(draft.key, updated)
        continue
      }

      const created = makeSetupFragment({ ...draft, content: draft.content as string }, order++)
      await createFragment(dataDir, storyId, created)
      if (created.type === 'prose') {
        await addProseSection(dataDir, storyId, created.id)
      }
      setupByKey.set(draft.key, created)
    }

    const fragments = [...setupByKey.values()]
      .sort((a, b) => a.order - b.order)
      .map(toPersisted)

    return { story: input.story, fragments }
  })
}
