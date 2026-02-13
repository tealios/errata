import { createAPIFileRoute } from '@tanstack/react-start/api'
import { app } from '@/server/api'

const handler = ({ request }: { request: Request }) => app.fetch(request)

export const APIRoute = createAPIFileRoute('/api/$')({
  GET: handler,
  POST: handler,
  PUT: handler,
  PATCH: handler,
  DELETE: handler,
})
