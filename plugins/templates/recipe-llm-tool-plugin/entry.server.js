import { tool, generateText } from 'ai'
import { z } from 'zod/v4'
import { t } from 'elysia'
import { definePlugin } from '@tealios/errata-plugin-sdk'
import { getModel } from '../../src/server/llm/client'

const plugin = definePlugin({
  manifest: {
    name: 'llm-tool-recipe',
    version: '0.1.0',
    description: 'LLM helper tool using active story provider/model',
    panel: { title: 'LLM Helper' },
  },

  tools: (dataDir, storyId) => ({
    brainstormScene: tool({
      description: 'Generate 5 scene ideas from a prompt',
      inputSchema: z.object({
        prompt: z.string().min(3),
      }),
      execute: async ({ prompt }) => {
        const { model, providerId, modelId } = await getModel(dataDir, storyId)
        const result = await generateText({
          model,
          prompt: `Return 5 concise scene ideas for: ${prompt}`,
        })

        return {
          providerId,
          modelId,
          ideas: result.text,
        }
      },
    }),
  }),

  routes: (app) => {
    app.post('/brainstorm', async ({ body, set }) => {
      const dataDir = process.env.DATA_DIR ?? './data'
      try {
        const { model, modelId } = await getModel(dataDir, body.storyId)
        const result = await generateText({
          model,
          prompt: `Brainstorm 3 ideas for: ${body.topic}`,
        })
        return { modelId, text: result.text }
      } catch (error) {
        set.status = 500
        return { error: String(error) }
      }
    }, {
      body: t.Object({
        storyId: t.String(),
        topic: t.String(),
      }),
    })

    return app
  },
})

export default plugin
