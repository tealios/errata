import { getFragment, listFragments } from '../fragments/storage'
import type { Fragment } from '../fragments/schema'

/**
 * Creates the helper functions available to custom block scripts as `ctx.*`.
 * Every call site that constructs a script context for `applyBlockConfig()`
 * should spread these helpers into the context object.
 */
export function createScriptHelpers(dataDir: string, storyId: string) {
  return {
    getFragment: (id: string) => getFragment(dataDir, storyId, id),
    getFragments: (type?: string) => listFragments(dataDir, storyId, type),

    getFragmentsByTag: async (tag: string): Promise<Fragment[]> => {
      const all = await listFragments(dataDir, storyId)
      return all.filter((f) => f.tags.includes(tag))
    },

    getFragmentByTag: async (tag: string): Promise<Fragment | null> => {
      const all = await listFragments(dataDir, storyId)
      return all.find((f) => f.tags.includes(tag)) ?? null
    },
  }
}
