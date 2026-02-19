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

export function configRoutes(dataDir: string) {
  return new Elysia()
    .get('/config/providers', async () => {
      return getGlobalConfigSafe(dataDir)
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
        createdAt: new Date().toISOString(),
      })
      const config = await addProvider(dataDir, provider)
      return {
        ...config,
        providers: config.providers.map((p) => ({
          ...p,
          apiKey: maskApiKey(p.apiKey),
        })),
      }
    }, {
      body: t.Object({
        name: t.String(),
        preset: t.Optional(t.String()),
        baseURL: t.String(),
        apiKey: t.String(),
        defaultModel: t.String(),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
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
      const config = await updateProviderConfig(dataDir, params.providerId, updates)
      return {
        ...config,
        providers: config.providers.map((p) => ({
          ...p,
          apiKey: maskApiKey(p.apiKey),
        })),
      }
    }, {
      body: t.Object({
        name: t.Optional(t.String()),
        baseURL: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        defaultModel: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
      }),
    })

    .delete('/config/providers/:providerId', async ({ params }) => {
      const config = await deleteProviderConfig(dataDir, params.providerId)
      return {
        ...config,
        providers: config.providers.map((p) => ({
          ...p,
          apiKey: maskApiKey(p.apiKey),
        })),
      }
    })

    .post('/config/providers/:providerId/duplicate', async ({ params }) => {
      const config = await duplicateProviderConfig(dataDir, params.providerId)
      return {
        ...config,
        providers: config.providers.map((p) => ({
          ...p,
          apiKey: maskApiKey(p.apiKey),
        })),
      }
    })

    .patch('/config/default-provider', async ({ body }) => {
      const config = await getGlobalConfig(dataDir)
      config.defaultProviderId = body.providerId
      await saveGlobalConfig(dataDir, config)
      return { ok: true, defaultProviderId: body.providerId }
    }, {
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
        const json = await res.json() as { data?: Array<{ id: string; owned_by?: string }> }
        const models = (json.data ?? []).map((m) => ({
          id: m.id,
          owned_by: m.owned_by,
        }))
        models.sort((a, b) => a.id.localeCompare(b.id))
        return { models }
      } catch (err) {
        return { models: [], error: err instanceof Error ? err.message : 'Unknown error fetching models' }
      }
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
        const json = await res.json() as { data?: Array<{ id: string; owned_by?: string }> }
        const models = (json.data ?? []).map((m) => ({
          id: m.id,
          owned_by: m.owned_by,
        }))
        models.sort((a, b) => a.id.localeCompare(b.id))
        return { models }
      } catch (err) {
        return { models: [], error: err instanceof Error ? err.message : 'Unknown error fetching models' }
      }
    }, {
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
      body: t.Object({
        providerId: t.Optional(t.String()),
        baseURL: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        model: t.String(),
        customHeaders: t.Optional(t.Record(t.String(), t.String())),
      }),
    })
}
