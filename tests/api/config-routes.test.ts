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

  it('discovers and tests Gemini models through the native Google API', async () => {
    await app.fetch(new Request('http://localhost/api/config/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Google Gemini',
        preset: 'custom',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'gemini-key',
        defaultModel: 'gemini-3.5-flash',
      }),
    }))
    const config = await (await app.fetch(new Request('http://localhost/api/config/providers'))).json() as {
      providers: Array<{ id: string }>
    }

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [
          { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-4-argon', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/antigravity-preview-latest', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const modelsRes = await app.fetch(new Request(
      `http://localhost/api/config/providers/${config.providers[0].id}/models`,
    ))
    const modelsBody = await modelsRes.json() as { models: Array<{ id: string }> }
    expect(modelsBody.models).toEqual([
      { id: 'gemini-3.5-flash', owned_by: 'google', isFree: false },
      { id: 'gemini-4-argon', owned_by: 'google', isFree: false },
    ])

    const testRes = await app.fetch(new Request('http://localhost/api/config/test-connection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: config.providers[0].id, model: 'gemini-3.8-flash' }),
    }))
    expect(await testRes.json()).toEqual({ ok: true, reply: 'Hello from Gemini' })

    expect(fetchMock).toHaveBeenNthCalledWith(1,
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
      }),
    )
    // 3.8+ rejects `minimal` and ignores `thinkingBudget`; the test ping must use `low`
    // or medium thinking eats the whole output budget and the reply comes back empty.
    const testBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    expect(testBody.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
  })
})
