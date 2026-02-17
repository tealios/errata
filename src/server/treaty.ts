import { treaty } from '@elysiajs/eden'
import type { App } from './api'

/**
 * Eden Treaty client for type-safe API calls.
 */
export function getTreaty(baseUrl = 'http://localhost:7739') {
  return treaty<App>(baseUrl).api
}
