import { t } from 'elysia'
import { definePlugin } from '@tealios/errata-plugin-sdk'

const plugin = definePlugin({
  manifest: {
    name: 'iframe-ui-recipe',
    version: '0.1.0',
    description: 'Runtime iframe UI panel example',
    panel: { title: 'Iframe UI' },
  },

  routes: (app) => {
    app.get('/panel-data', ({ query }) => {
      return {
        storyId: query.storyId,
        now: new Date().toISOString(),
        message: 'Hello from plugin API route',
      }
    }, {
      query: t.Object({ storyId: t.String() }),
    })

    return app
  },
})

export default plugin
