// Recipe: reading and updating story fragments

import { listFragments, getFragment, updateFragment } from '../../../src/server/fragments/storage'

export async function listCharacterFragments(dataDir, storyId) {
  return listFragments(dataDir, storyId, 'character')
}

export async function appendToFragment(dataDir, storyId, fragmentId, extraText) {
  const fragment = await getFragment(dataDir, storyId, fragmentId)
  if (!fragment) {
    return { ok: false, error: 'Fragment not found' }
  }

  const updated = {
    ...fragment,
    content: `${fragment.content}\n\n${extraText}`,
    updatedAt: new Date().toISOString(),
  }

  await updateFragment(dataDir, storyId, updated)
  return { ok: true, fragmentId }
}
