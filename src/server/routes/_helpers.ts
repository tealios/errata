import { getStory } from '../fragments/storage'
import type { StoryMeta } from '../fragments/schema'

type StoryCtx = {
  params: { storyId: string }
  set: { status?: number | string }
  [key: string]: unknown
}

/**
 * Wraps an Elysia handler with the "get story, 404 if missing" preamble.
 * The inner handler receives the resolved story plus the original Elysia
 * context (body/query/etc are preserved via structural typing).
 */
export function withStory<R>(
  dataDir: string,
  handler: (story: StoryMeta, ctx: any) => R | Promise<R>,
): (ctx: StoryCtx) => Promise<R | { error: string }> {
  return async (ctx) => {
    const story = await getStory(dataDir, ctx.params.storyId)
    if (!story) {
      ctx.set.status = 404
      return { error: 'Story not found' }
    }
    return handler(story, ctx)
  }
}
