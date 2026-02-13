import { treaty } from '@elysiajs/eden'
import type { App } from './api'

/**
 * Eden Treaty client for type-safe API calls.
 * Server-side: calls Elysia directly (no HTTP overhead).
 * Client-side: calls via HTTP with full type inference.
 */
export function getTreaty(baseUrl = 'http://localhost:3000') {
  return treaty<App>(baseUrl).api
}
