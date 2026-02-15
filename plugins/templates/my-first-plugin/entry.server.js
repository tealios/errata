import { tool, generateText } from 'ai'
import { z } from 'zod/v4'
import { t } from 'elysia'
import { definePlugin } from '@tealios/errata-plugin-sdk'
import { listFragments } from '../../src/server/fragments/storage'
import { getModel } from '../../src/server/llm/client'

const plugin = definePlugin({
  manifest: {
    name: 'my-plugin',
    version: '0.1.0',
    description: 'Starter plugin template',
    panel: { title: 'My Plugin' },
  },

  // Recipe: register custom fragment types
  fragmentTypes: [
    {
      type: 'idea',
      prefix: 'id',
      stickyByDefault: false,
      contextRenderer(fragment) {
        return `### Idea: ${fragment.name}\n${fragment.content}`
      },
      shortlistFields: ['id', 'name', 'description'],
      llmTools: true,
    },
  ],

  // Recipe: plugin tools available during generation
  tools: (dataDir, storyId) => ({
    summarizeStory: tool({
      description: 'Summarize current non-prose fragments in this story',
      inputSchema: z.object({
        maxItems: z.number().int().min(1).max(20).default(8),
      }),
      execute: async ({ maxItems }) => {
        const fragments = await listFragments(dataDir, storyId)
        const source = fragments
          .filter((f) => f.type !== 'prose')
          .slice(0, maxItems)
          .map((f) => `${f.type}:${f.id} ${f.name} - ${f.description}`)
          .join('\n')

        const { model, modelId } = await getModel(dataDir, storyId)
        const result = await generateText({
          model,
          prompt: `Summarize these story fragments in 3 bullets:\n\n${source}`,
        })

        return {
          modelId,
          summary: result.text,
          count: fragments.length,
        }
      },
    }),
  }),

  // Recipe: plugin routes mounted under /api/plugins/my-plugin/*
  routes: (app) => {
    app.get('/health', () => ({ ok: true, plugin: 'my-plugin' }))

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

  // Recipe: lifecycle hooks
  hooks: {
    beforeContext: async (ctx) => {
      // Example: add an extra system hint message
      ctx.messages.push({
        role: 'system',
        content: 'Plugin note: keep continuity with established character goals.',
      })
      return ctx
    },
  },
})

export default plugin
