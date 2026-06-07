import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from '@/server/api'
import { createTempDir } from '../setup'
import {
  createOpenRouterOAuthAuthorizationUrl,
  handleOpenRouterOAuthCallbackRequest,
} from '@/server/openrouter-oauth-callback'

describe('config routes', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    app = createApp(dataDir)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await cleanup()
  })

  it('exchanges an OpenRouter OAuth code and stores a free-router provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ key: 'or-oauth-key' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))

    const res = await app.fetch(new Request('http://localhost/api/config/openrouter/oauth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'returned-code',
        codeVerifier: 'verifier',
        codeChallengeMethod: 'S256',
      }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      defaultProviderId: string | null
      providers: Array<{ id: string; name: string; preset: string; defaultModel: string; apiKey: string }>
    }
    expect(body.providers).toHaveLength(1)
    expect(body.defaultProviderId).toBe(body.providers[0].id)
    expect(body.providers[0]).toMatchObject({
      name: 'OpenRouter',
      preset: 'openrouter',
      defaultModel: 'openrouter/free',
      apiKey: '••••-key',
    })

    expect(fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/auth/keys', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        code: 'returned-code',
        code_verifier: 'verifier',
        code_challenge_method: 'S256',
      }),
    }))
  })

  it('accepts OpenRouter OAuth on the main localhost callback route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ key: 'or-oauth-key' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))

    const { authUrl } = createOpenRouterOAuthAuthorizationUrl(dataDir)
    const openRouterUrl = new URL(authUrl)
    const callbackUrl = new URL(openRouterUrl.searchParams.get('callback_url')!)
    callbackUrl.searchParams.set('code', 'returned-code')

    const callbackRes = await handleOpenRouterOAuthCallbackRequest(new Request(callbackUrl))
    expect(callbackRes.status).toBe(200)
    await expect(callbackRes.text()).resolves.toContain('OpenRouter connected')

    const configRes = await app.fetch(new Request('http://localhost/api/config/providers'))
    const config = await configRes.json() as {
      providers: Array<{ preset: string; defaultModel: string; apiKey: string }>
    }
    expect(config.providers[0]).toMatchObject({
      preset: 'openrouter',
      defaultModel: 'openrouter/free',
      apiKey: '••••-key',
    })
  })

  it('adds the OpenRouter free router and flags free models in model discovery', async () => {
    await app.fetch(new Request('http://localhost/api/config/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'OpenRouter',
        preset: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: 'or-key',
        defaultModel: 'openrouter/free',
      }),
    }))
    const configRes = await app.fetch(new Request('http://localhost/api/config/providers'))
    const config = await configRes.json() as {
      providers: Array<{ id: string }>
    }

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          id: 'paid/model',
          owned_by: 'paid',
          pricing: { prompt: '0.001', completion: '0.002' },
        },
        {
          id: 'free/model:free',
          owned_by: 'free',
          pricing: { prompt: '0', completion: '0' },
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))

    const modelsRes = await app.fetch(new Request(`http://localhost/api/config/providers/${config.providers[0].id}/models`))
    expect(modelsRes.status).toBe(200)
    const body = await modelsRes.json() as { models: Array<{ id: string; isFree?: boolean; owned_by?: string }> }
    expect(body.models[0]).toMatchObject({ id: 'openrouter/free', isFree: true, owned_by: 'openrouter' })
    expect(body.models.find((m) => m.id === 'free/model:free')?.isFree).toBe(true)
    expect(body.models.find((m) => m.id === 'paid/model')?.isFree).toBe(false)
  })
})
