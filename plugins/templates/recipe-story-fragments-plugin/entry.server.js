import { tool } from 'ai'
import { z } from 'zod/v4'
import { t } from 'elysia'
import { definePlugin } from '@tealios/errata-plugin-sdk'
import { getFragment, listFragments, updateFragment } from '../../src/server/fragments/storage'

const plugin = definePlugin({
  manifest: {
    name: 'story-fragments-recipe',
    version: '0.1.0',
    description: 'Reads and updates fragments in a story',
    panel: { title: 'Fragment Ops' },
  },

  tools: (dataDir, storyId) => ({
    appendToFragment: tool({
      description: 'Append text to an existing fragment by id',
      inputSchema: z.object({
        fragmentId: z.string(),
        text: z.string(),
      }),
      execute: async ({ fragmentId, text }) => {
        const fragment = await getFragment(dataDir, storyId, fragmentId)
        if (!fragment) return { ok: false, error: 'Fragment not found' }

        const updated = {
          ...fragment,
          content: `${fragment.content}\n\n${text}`,
          updatedAt: new Date().toISOString(),
        }
        await updateFragment(dataDir, storyId, updated)

        return { ok: true, id: fragmentId }
      },
    }),
  }),

  routes: (app) => {
    app.get('/fragments', async ({ query }) => {
      const dataDir = process.env.DATA_DIR ?? './data'
      const fragments = await listFragments(dataDir, query.storyId, query.type || undefined)
      return { count: fragments.length, fragments }
    }, {
      query: t.Object({
        storyId: t.String(),
        type: t.Optional(t.String()),
      }),
    })

    return app
  },
})

export default plugin
