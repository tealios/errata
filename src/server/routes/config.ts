import { Elysia, t } from 'elysia'
import {
  getGlobalConfigSafe,
  addProvider,
  updateProvider as updateProviderConfig,
  deleteProvider as deleteProviderConfig,
  duplicateProvider as duplicateProviderConfig,
  getGlobalConfig,
  saveGlobalConfig,
  getProvider,
  maskApiKey,
} from '../config/storage'
import { ProviderConfigSchema } from '../config/schema'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_FREE_MODEL_ID = 'openrouter/free'

function maskConfigProviders<T extends { providers: Array<{ apiKey: string }> }>(config: T): T {
  return {
    ...config,
    providers: config.providers.map((p) => ({
      ...p,
      apiKey: maskApiKey(p.apiKey),
    })),
  }
}

function isOpenRouterProvider(provider: { preset?: string; baseURL: string }) {
  return provider.preset === 'openrouter' || provider.baseURL.includes('openrouter.ai')
}

function isFreeModel(model: { id: string; pricing?: { prompt?: string; completion?: string } }) {
  return model.id === OPENROUTER_FREE_MODEL_ID
    || model.id.endsWith(':free')
    || (model.pricing?.prompt === '0' && model.pricing?.completion === '0')
}

function normalizeModels(
  rawModels: Array<{ id: string; owned_by?: string; pricing?: { prompt?: string; completion?: string } }>,
  provider: { preset?: string; baseURL: string },
) {
  const models = rawModels.map((m) => ({
    id: m.id,
    owned_by: m.owned_by,
    isFree: isFreeModel(m),
  }))

  if (isOpenRouterProvider(provider) && !models.some((m) => m.id === OPENROUTER_FREE_MODEL_ID)) {
    models.push({ id: OPENROUTER_FREE_MODEL_ID, owned_by: 'openrouter', isFree: true })
  }

  models.sort((a, b) => {
    if (a.id === OPENROUTER_FREE_MODEL_ID) return -1
    if (b.id === OPENROUTER_FREE_MODEL_ID) return 1
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1
    return a.id.localeCompare(b.id)
  })

  return models
}

export function configRoutes(dataDir: string) {
  return new Elysia({ detail: { tags: ['Config'] } })
    .get('/config/providers', async () => {
      return getGlobalConfigSafe(dataDir)
    }, {
      detail: { summary: 'Get global config with masked API keys' },
    })

    .post('/config/providers', async ({ body }) => {
      const id = `prov-${Date.now().toString(36)}`
      const provider = ProviderConfigSchema.parse({
        id,
        name: body.name,
        preset: body.preset ?? 'custom',
        baseURL: body.baseURL,
        apiKey: body.apiKey,
        defaultModel: body.defaultModel,
        enabled: true,
        customHeaders: body.customHeaders ?? {},
        temperature: body.temperature,
        createdAt: new Date().toISOString(),
      })
      const config = await addProvider(dataDir, provider)
      return maskConfigProviders(config)
    }, {
      detail: { summary: 'Add a new provider' },
      body: t.Object({
        name: t.String(),
        preset: t.Optional(t.String()),
        baseURL: t.String(),
        apiKey: t.String(),
        defaultModel: t.String(),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
        temperature: t.Optional(t.Number()),
      }),
    })

    .put('/config/providers/:providerId', async ({ params, body }) => {
      const updates: Record<string, unknown> = {}
      if (body.name !== undefined) updates.name = body.name
      if (body.baseURL !== undefined) updates.baseURL = body.baseURL
      if (body.apiKey !== undefined) updates.apiKey = body.apiKey
      if (body.defaultModel !== undefined) updates.defaultModel = body.defaultModel
      if (body.enabled !== undefined) updates.enabled = body.enabled
      if (body.customHeaders !== undefined) updates.customHeaders = body.customHeaders
      if (body.temperature !== undefined) updates.temperature = body.temperature
      const config = await updateProviderConfig(dataDir, params.providerId, updates)
      return maskConfigProviders(config)
    }, {
      detail: { summary: 'Update a provider' },
      body: t.Object({
        name: t.Optional(t.String()),
        baseURL: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        defaultModel: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
        temperature: t.Optional(t.Union([t.Number(), t.Null()])),
      }),
    })

    .delete('/config/providers/:providerId', async ({ params }) => {
      const config = await deleteProviderConfig(dataDir, params.providerId)
      return maskConfigProviders(config)
    }, {
      detail: { summary: 'Delete a provider' },
    })

    .post('/config/providers/:providerId/duplicate', async ({ params }) => {
      const config = await duplicateProviderConfig(dataDir, params.providerId)
      return maskConfigProviders(config)
    }, {
      detail: { summary: 'Duplicate a provider' },
    })

    .patch('/config/default-provider', async ({ body }) => {
      const config = await getGlobalConfig(dataDir)
      config.defaultProviderId = body.providerId
      await saveGlobalConfig(dataDir, config)
      return { ok: true, defaultProviderId: body.providerId }
    }, {
      detail: { summary: 'Set the default provider' },
      body: t.Object({
        providerId: t.Union([t.String(), t.Null()]),
      }),
    })

    .get('/config/providers/:providerId/models', async ({ params, set }) => {
      const provider = await getProvider(dataDir, params.providerId)
      if (!provider) {
        set.status = 404
        return { models: [], error: 'Provider not found' }
      }
      try {
        const base = provider.baseURL.replace(/\/+$/, '')
        const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            ...(provider.customHeaders ?? {}),
          },
        })
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          return { models: [], error: `Failed to fetch models: ${res.status} ${text}` }
        }
        const json = await res.json() as { data?: Array<{ id: string; owned_by?: string; pricing?: { prompt?: string; completion?: string } }> }
        const models = normalizeModels(json.data ?? [], provider)
        return { models }
      } catch (err) {
        return { models: [], error: err instanceof Error ? err.message : 'Unknown error fetching models' }
      }
    }, {
      detail: { summary: 'List models from a provider' },
    })

    // Fetch models with arbitrary credentials (for unsaved providers, avoids CORS)
    .post('/config/test-models', async ({ body }) => {
      try {
        const base = body.baseURL.replace(/\/+$/, '')
        const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${body.apiKey}`,
            ...(body.customHeaders ?? {}),
          },
        })
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          return { models: [], error: `Failed to fetch models: ${res.status} ${text}` }
        }
        const json = await res.json() as { data?: Array<{ id: string; owned_by?: string; pricing?: { prompt?: string; completion?: string } }> }
        const models = normalizeModels(json.data ?? [], { preset: undefined, baseURL: body.baseURL })
        return { models }
      } catch (err) {
        return { models: [], error: err instanceof Error ? err.message : 'Unknown error fetching models' }
      }
    }, {
      detail: { summary: 'Fetch models with arbitrary credentials' },
      body: t.Object({
        baseURL: t.String(),
        apiKey: t.String(),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
      }),
    })

    // Test a provider by sending a short chat completion
    // Can use either providerId (reads stored credentials) or inline baseURL+apiKey
    .post('/config/test-connection', async ({ body }) => {
      let baseURL = body.baseURL
      let apiKey = body.apiKey
      let customHeaders = body.customHeaders ?? {}

      // If providerId is given, use stored credentials as fallback
      if (body.providerId) {
        const stored = await getProvider(dataDir, body.providerId)
        if (stored) {
          if (!baseURL) baseURL = stored.baseURL
          if (!apiKey) apiKey = stored.apiKey
          if (Object.keys(customHeaders).length === 0) customHeaders = stored.customHeaders ?? {}
        }
      }

      if (!baseURL || !apiKey || !body.model) {
        return { ok: false, error: 'Base URL, API key, and model are required' }
      }

      try {
        const base = baseURL.replace(/\/+$/, '')
        const url = /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...customHeaders,
          },
          body: JSON.stringify({
            model: body.model,
            messages: [{ role: 'user', content: 'Hello! (keep your response short)' }],
            max_tokens: 64,
          }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          return { ok: false, error: `${res.status} ${text}` }
        }
        const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
        const reply = json.choices?.[0]?.message?.content ?? ''
        return { ok: true, reply }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' }
      }
    }, {
      detail: { summary: 'Test provider connection' },
      body: t.Object({
        providerId: t.Optional(t.String()),
        baseURL: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        model: t.String(),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
      }),
    })

    .post('/config/openrouter/oauth/exchange', async ({ body, set }) => {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: body.code,
            code_verifier: body.codeVerifier,
            code_challenge_method: body.codeChallengeMethod,
          }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          set.status = res.status
          return { error: `OpenRouter OAuth failed: ${text}` }
        }
        const json = await res.json() as { key?: string }
        if (!json.key) {
          set.status = 502
          return { error: 'OpenRouter OAuth did not return an API key' }
        }

        const config = await getGlobalConfig(dataDir)
        const existingIdx = config.providers.findIndex((p) => isOpenRouterProvider(p))
        const now = new Date().toISOString()
        if (existingIdx === -1) {
          const provider = ProviderConfigSchema.parse({
            id: `prov-${Date.now().toString(36)}`,
            name: 'OpenRouter',
            preset: 'openrouter',
            baseURL: OPENROUTER_BASE_URL,
            apiKey: json.key,
            defaultModel: OPENROUTER_FREE_MODEL_ID,
            enabled: true,
            customHeaders: {},
            createdAt: now,
          })
          config.providers.push(provider)
          if (!config.defaultProviderId) {
            config.defaultProviderId = provider.id
          }
        } else {
          config.providers[existingIdx] = {
            ...config.providers[existingIdx],
            name: config.providers[existingIdx].name || 'OpenRouter',
            preset: 'openrouter',
            baseURL: OPENROUTER_BASE_URL,
            apiKey: json.key,
            defaultModel: config.providers[existingIdx].defaultModel || OPENROUTER_FREE_MODEL_ID,
            enabled: true,
          }
        }

        await saveGlobalConfig(dataDir, config)
        return maskConfigProviders(config)
      } catch (err) {
        set.status = 502
        return { error: err instanceof Error ? err.message : 'OpenRouter OAuth exchange failed' }
      }
    }, {
      detail: { summary: 'Exchange an OpenRouter OAuth code for a provider API key' },
      body: t.Object({
        code: t.String(),
        codeVerifier: t.String(),
        codeChallengeMethod: t.Optional(t.Union([t.Literal('S256'), t.Literal('plain')])),
      }),
    })
}
