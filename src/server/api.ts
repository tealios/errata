import { Elysia } from 'elysia'

export const app = new Elysia({ prefix: '/api' })
  .get('/health', () => ({ status: 'ok' }))

export type App = typeof app
