import { createFileRoute } from '@tanstack/react-router'
import { getApp } from '@/server/init'

const handler = async ({ request }: { request: Request }) => {
  const app = await getApp()
  return app.fetch(request)
}

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
    },
  },
})
