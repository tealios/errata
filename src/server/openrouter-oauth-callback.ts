import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { getGlobalConfig, saveGlobalConfig } from './config/storage'
import { ProviderConfigSchema } from './config/schema'

const CALLBACK_PORT = 3000
const CALLBACK_PATH = '/openrouter-oauth-callback'
const SESSION_TTL_MS = 10 * 60 * 1000
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_FREE_MODEL_ID = 'openrouter/free'

let callbackServer: Server | null = null
let callbackServerStarting: Promise<void> | null = null
const sessions = new Map<string, { verifier: string; dataDir: string; expiresAt: number }>()

function base64Url(bytes: Buffer) {
  return bytes.toString('base64url')
}

function createCodeChallenge(verifier: string) {
  return base64Url(createHash('sha256').update(verifier).digest())
}

function isOpenRouterProvider(provider: { preset?: string; baseURL: string }) {
  return provider.preset === 'openrouter' || provider.baseURL.includes('openrouter.ai')
}

function renderHtml(status: number, body: string) {
  return new Response(`<!doctype html>
<html>
  <head>
    <title>Errata OpenRouter OAuth</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; color: #171717; }
      p { color: #525252; }
      code { background: #f5f5f5; padding: 0.125rem 0.25rem; border-radius: 0.25rem; }
    </style>
  </head>
  <body>${body}</body>
</html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

async function sendResponse(res: ServerResponse, response: Response) {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  res.writeHead(response.status, headers)
  res.end(await response.text())
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function exchangeCodeForKey(code: string, verifier: string) {
  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      code_challenge_method: 'S256',
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`OpenRouter OAuth failed: ${res.status} ${text}`)
  }

  const json = await res.json() as { key?: string }
  if (!json.key) throw new Error('OpenRouter OAuth did not return an API key')
  return json.key
}

export async function saveOpenRouterOAuthProvider(dataDir: string, apiKey: string) {
  const config = await getGlobalConfig(dataDir)
  const existingIdx = config.providers.findIndex((p) => isOpenRouterProvider(p))
  const now = new Date().toISOString()

  if (existingIdx === -1) {
    const provider = ProviderConfigSchema.parse({
      id: `prov-${Date.now().toString(36)}`,
      name: 'OpenRouter',
      preset: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      defaultModel: OPENROUTER_FREE_MODEL_ID,
      enabled: true,
      customHeaders: {},
      createdAt: now,
    })
    config.providers.push(provider)
    if (!config.defaultProviderId) config.defaultProviderId = provider.id
  } else {
    config.providers[existingIdx] = {
      ...config.providers[existingIdx],
      name: config.providers[existingIdx].name || 'OpenRouter',
      preset: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      defaultModel: config.providers[existingIdx].defaultModel || OPENROUTER_FREE_MODEL_ID,
      enabled: true,
    }
  }

  await saveGlobalConfig(dataDir, config)
  return config
}

export async function exchangeAndSaveOpenRouterOAuthCode(dataDir: string, code: string, verifier: string) {
  const apiKey = await exchangeCodeForKey(code, verifier)
  return saveOpenRouterOAuthProvider(dataDir, apiKey)
}

export async function handleOpenRouterOAuthCallbackRequest(request: Request) {
  const url = new URL(request.url)

  if (url.pathname === `${CALLBACK_PATH}/health`) {
    return Response.json({ ok: true }, {
      headers: {
        'access-control-allow-origin': '*',
      },
    })
  }

  if (url.pathname !== CALLBACK_PATH) {
    return renderHtml(404, '<p>Not found.</p>')
  }

  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const sessionId = url.searchParams.get('session_id')

  if (error) {
    return renderHtml(400, `<h1>OpenRouter sign-in failed</h1><p>${escapeHtml(error)}</p>`)
  }

  if (!code || !sessionId) {
    return renderHtml(400, '<h1>OpenRouter sign-in failed</h1><p>The callback was missing its code or session.</p>')
  }

  const session = sessions.get(sessionId)
  sessions.delete(sessionId)
  if (!session || session.expiresAt < Date.now()) {
    return renderHtml(400, '<h1>OpenRouter sign-in expired</h1><p>Return to Errata and start the OpenRouter connection again.</p>')
  }

  try {
    await exchangeAndSaveOpenRouterOAuthCode(session.dataDir, code, session.verifier)
    return renderHtml(200, '<h1>OpenRouter connected</h1><p>You may close this window and return to Errata.</p>')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OpenRouter OAuth exchange failed'
    return renderHtml(502, `<h1>OpenRouter sign-in failed</h1><p>${escapeHtml(message)}</p>`)
  }
}

export function createOpenRouterOAuthAuthorizationUrl(dataDir: string) {
  const sessionId = base64Url(randomBytes(32))
  const verifier = base64Url(randomBytes(48))
  sessions.set(sessionId, { verifier, dataDir, expiresAt: Date.now() + SESSION_TTL_MS })

  const callback = new URL(`http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`)
  callback.searchParams.set('session_id', sessionId)

  const authUrl = new URL('https://openrouter.ai/auth')
  authUrl.searchParams.set('callback_url', callback.toString())
  authUrl.searchParams.set('code_challenge', createCodeChallenge(verifier))
  authUrl.searchParams.set('code_challenge_method', 'S256')

  return { authUrl: authUrl.toString() }
}

export function ensureOpenRouterOAuthCallbackBridge() {
  if (callbackServer?.listening || callbackServerStarting) {
    return callbackServerStarting ?? Promise.resolve()
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`)
    void handleOpenRouterOAuthCallbackRequest(new Request(url)).then((response) => {
      return sendResponse(res, response)
    }).catch((err) => {
      const message = err instanceof Error ? err.message : 'Unknown error'
      void sendResponse(res, renderHtml(500, `<h1>OpenRouter sign-in failed</h1><p>${escapeHtml(message)}</p>`))
    })
  })
  callbackServer = server

  callbackServerStarting = new Promise<void>((resolve) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      callbackServer = null
      callbackServerStarting = null
      if (err.code === 'EADDRINUSE') {
        console.warn('[openrouter] OAuth callback bridge skipped: localhost:3000 is already in use.')
        resolve()
        return
      }
      console.warn('[openrouter] OAuth callback bridge failed:', err)
      resolve()
    })
    server.listen(CALLBACK_PORT, () => {
      callbackServerStarting = null
      console.info(`[openrouter] OAuth callback bridge listening at http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`)
      resolve()
    })
  })

  return callbackServerStarting
}
