import { getFragment, listFragments } from '../fragments/storage'
import { createStreamingRunner } from '../agents/create-streaming-runner'
import type { Fragment } from '../fragments/schema'
import type { AgentStreamResult } from '../agents/stream-types'

export interface OptimizeCharacterOptions {
  fragmentId: string
  instructions?: string
  maxSteps?: number
}

export type OptimizeCharacterResult = AgentStreamResult

export const optimizeCharacter = createStreamingRunner<OptimizeCharacterOptions, { fragment: Fragment }>({
  name: 'librarian.optimize-character',
  readOnly: false,

  validate: async ({ dataDir, storyId, opts }) => {
    const fragment = await getFragment(dataDir, storyId, opts.fragmentId)
    if (!fragment) throw new Error(`Fragment ${opts.fragmentId} not found`)
    if (fragment.type !== 'character') throw new Error(`Fragment ${opts.fragmentId} is type "${fragment.type}", expected "character"`)
    return { fragment }
  },

  contextOptions: (opts) => ({ excludeFragmentId: opts.fragmentId }),

  extraContext: async ({ dataDir, storyId, validated, opts }) => ({
    allCharacters: await listFragments(dataDir, storyId, 'character'),
    targetFragment: validated.fragment,
    instructions: opts.instructions,
  }),
})
