import { Elysia } from 'elysia'
import { getSessionUsage, getProjectUsage } from '../llm/token-tracker'

export function tokenUsageRoutes(dataDir: string) {
  return new Elysia({ detail: { tags: ['Token Usage'] } })
    .get('/stories/:storyId/token-usage', async ({ params }) => {
      const session = getSessionUsage(params.storyId)
      const project = await getProjectUsage(dataDir, params.storyId)

      return {
        session: {
          sources: session.sources,
          total: session.total,
          byModel: session.byModel,
        },
        project: {
          sources: project.sources,
          total: project.total,
          byModel: project.byModel,
        },
      }
    }, {
      detail: { summary: 'Get session and project token usage' },
    })
}
