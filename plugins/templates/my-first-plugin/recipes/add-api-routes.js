// Recipe: plugin API routes

import { t } from 'elysia'

export function attachExampleRoutes(app) {
  app.get('/hello', () => ({ ok: true, message: 'hello from plugin' }))

  app.get('/echo', ({ query }) => ({
    echo: query.text,
  }), {
    query: t.Object({
      text: t.String(),
    }),
  })

  return app
}
