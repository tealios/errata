import { tool } from 'ai'
import { z } from 'zod/v4'
import { t } from 'elysia'
import { definePlugin } from '@tealios/errata-plugin-sdk'
import { listFragments } from '../../src/server/fragments/storage'

const plugin = definePlugin({
  manifest: {
    name: 'fragment-type-recipe',
    version: '0.1.0',
    description: 'Registers a custom fragment type for location beats',
    panel: { title: 'Location Notes' },
  },

  fragmentTypes: [
    {
      type: 'locationNote',
      prefix: 'ln',
      stickyByDefault: false,
      contextRenderer(fragment) {
        return `### Location Note: ${fragment.name}\n${fragment.content}`
      },
      shortlistFields: ['id', 'name', 'description'],
      llmTools: true,
    },
  ],

  tools: (dataDir, storyId) => ({
    listLocationNotes: tool({
      description: 'List locationNote fragments in the current story',
      inputSchema: z.object({}),
      execute: async () => {
        const notes = await listFragments(dataDir, storyId, 'locationNote')
        return {
          count: notes.length,
          notes: notes.map((n) => ({ id: n.id, name: n.name, description: n.description })),
        }
      },
    }),
  }),

  routes: (app) => {
    app.get('/location-notes', async ({ query }) => {
      const dataDir = process.env.DATA_DIR ?? './data'
      const notes = await listFragments(dataDir, query.storyId, 'locationNote')
      return { count: notes.length, notes }
    }, {
      query: t.Object({ storyId: t.String() }),
    })

    return app
  },
})

export default plugin
