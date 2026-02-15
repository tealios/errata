import { tool } from 'ai'
import { z } from 'zod/v4'
import { Elysia, t } from 'elysia'
import type { WritingPlugin } from '@tealios/errata-plugin-sdk'

const NAMES: Record<string, Record<string, string[]>> = {
  fantasy: {
    male: ['Aldric', 'Theron', 'Caelum', 'Orin', 'Fenris'],
    female: ['Elowen', 'Seraphina', 'Isolde', 'Lyra', 'Freya'],
    neutral: ['Rowan', 'Sage', 'Aspen', 'Phoenix', 'Ember'],
  },
  scifi: {
    male: ['Zephyr', 'Orion', 'Cyrus', 'Nova', 'Axel'],
    female: ['Aria', 'Luna', 'Stella', 'Vega', 'Celeste'],
    neutral: ['Kai', 'Ryn', 'Sol', 'Echo', 'Onyx'],
  },
  historical: {
    male: ['Edmund', 'William', 'Henry', 'Arthur', 'Richard'],
    female: ['Eleanor', 'Margaret', 'Catherine', 'Elizabeth', 'Anne'],
    neutral: ['Morgan', 'Robin', 'Avery', 'Devon', 'Quinn'],
  },
}

const THEMES = Object.keys(NAMES)

const plugin: WritingPlugin = {
  manifest: {
    name: 'names',
    version: '1.0.0',
    description: 'Generate character names by theme and gender',
    panel: { title: 'Names' },
  },

  tools: (_dataDir, _storyId) => ({
    generateName: tool({
      description: 'Generate a character name based on theme and gender',
      inputSchema: z.object({
        theme: z.enum(THEMES as [string, ...string[]]).describe('Name theme: fantasy, scifi, or historical'),
        gender: z.enum(['male', 'female', 'neutral']).describe('Gender category'),
      }),
      execute: async ({ theme, gender }) => {
        const list = NAMES[theme]?.[gender]
        if (!list || list.length === 0) {
          return { error: `No names found for theme="${theme}" gender="${gender}"` }
        }
        const name = list[Math.floor(Math.random() * list.length)]
        return { name, theme, gender }
      },
    }),
  }),

  routes: (app) => {
    app.get('/themes', () => {
      return { themes: THEMES }
    })
    app.post('/generate', ({ body, set }) => {
      const list = NAMES[body.theme]?.[body.gender]
      if (!list || list.length === 0) {
        set.status = 400
        return { error: `No names found for theme="${body.theme}" gender="${body.gender}"` }
      }
      const name = list[Math.floor(Math.random() * list.length)]
      return { name, theme: body.theme, gender: body.gender }
    }, {
      body: t.Object({
        theme: t.String(),
        gender: t.String(),
      }),
    })
    return app
  },
}

export default plugin
