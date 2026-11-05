import { Elysia, t } from 'elysia'
import { createAgentInstance } from '../agents'
import { getStory } from '../fragments/storage'
import { encodeStream } from './encode-stream'
import { applyStorySetupPlan, generateStorySetupPlan } from '../story-setup/plan'
import { createLogger } from '../logging'

export function storySetupRoutes(dataDir: string) {
  const logger = createLogger('api:story-setup', { dataDir })

  return new Elysia({ detail: { tags: ['Story Setup'] } })
    .post('/stories/:storyId/setup/chat', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      let agent: ReturnType<typeof createAgentInstance> | undefined
      try {
        agent = createAgentInstance('story-setup.chat', { dataDir, storyId: params.storyId })
        const { eventStream } = await agent.execute({ messages: body.messages })
        return new Response(encodeStream(eventStream), {
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        })
      } catch (error) {
        agent?.fail(error)
        logger.error('Story setup chat failed', {
          storyId: params.storyId,
          error: error instanceof Error ? error.message : String(error),
        })
        set.status = 502
        return { error: error instanceof Error ? error.message : 'Story setup chat failed' }
      }
    }, {
      body: t.Object({
        messages: t.Array(t.Object({
          role: t.Union([t.Literal('user'), t.Literal('assistant')]),
          content: t.String(),
        })),
      }),
      detail: { summary: 'Continue the conversational story setup' },
    })
    .post('/stories/:storyId/setup/complete', async ({ params, body, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      if (!body.messages.some(message => message.role === 'user' && message.content.trim())) {
        set.status = 422
        return { error: 'Tell Errata something about the story first' }
      }

      try {
        const plan = await generateStorySetupPlan(
          dataDir,
          params.storyId,
          body.messages,
          body.draftFragments ?? [],
        )
        const result = await applyStorySetupPlan(dataDir, params.storyId, plan)
        return { plan, ...result }
      } catch (error) {
        logger.error('Story setup completion failed', {
          storyId: params.storyId,
          error: error instanceof Error ? error.message : String(error),
        })
        set.status = 502
        return { error: error instanceof Error ? error.message : 'Could not create story setup' }
      }
    }, {
      body: t.Object({
        messages: t.Array(t.Object({
          role: t.Union([t.Literal('user'), t.Literal('assistant')]),
          content: t.String(),
        })),
        draftFragments: t.Optional(t.Array(t.Object({
          key: t.String({ minLength: 1, maxLength: 50, pattern: '^[a-z0-9][a-z0-9-]*$' }),
          type: t.Union([
            t.Literal('guideline'),
            t.Literal('knowledge'),
            t.Literal('character'),
            t.Literal('prose'),
          ]),
          name: t.String({ minLength: 1, maxLength: 100 }),
          description: t.String({ minLength: 1, maxLength: 250 }),
          content: t.String({ minLength: 1 }),
        }))),
      }),
      detail: { summary: 'Create starter fragments from the setup conversation' },
    })
}
