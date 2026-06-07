import { createFileRoute } from '@tanstack/react-router'
import { handleOpenRouterOAuthCallbackRequest } from '@/server/openrouter-oauth-callback'

const handler = async ({ request }: { request: Request }) => {
  return handleOpenRouterOAuthCallbackRequest(request)
}

export const Route = createFileRoute('/openrouter-oauth-callback')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
