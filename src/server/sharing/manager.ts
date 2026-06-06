import { createServer, request, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect as netConnect } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { getSharingConfig } from '../config/storage'
import type { SharingConfig } from '../config/schema'
import { checkBasicAuth } from './auth'
import { appPort, getLanUrl } from './network'
import { ensureCloudflared, parseTunnelUrl } from './cloudflared'
import { createLogger } from '../logging'

const logger = createLogger('sharing')

/** Preferred port for the LAN/auth proxy; falls back upward if taken. */
const SHARE_PORT = 7740
const SHARE_PORT_MAX = SHARE_PORT + 20

export type TunnelStatus = 'stopped' | 'downloading' | 'starting' | 'running' | 'error'

interface State {
  dataDir: string | null
  current: SharingConfig | null
  proxy: Server | null
  proxyPort: number | null
  /** localhost family the app actually listens on (probed at proxy start). */
  upstreamHost: string
  tunnelProc: ChildProcess | null
  tunnelUrl: string | null
  tunnelStatus: TunnelStatus
  tunnelError: string | null
}

const state: State = {
  dataDir: null,
  current: null,
  proxy: null,
  proxyPort: null,
  upstreamHost: '127.0.0.1',
  tunnelProc: null,
  tunnelUrl: null,
  tunnelStatus: 'stopped',
  tunnelError: null,
}

function authReady(s: SharingConfig | null): boolean {
  return !!s && s.authEnabled && !!s.passwordHash
}

function handleProxyRequest(req: IncomingMessage, res: ServerResponse) {
  const s = state.current
  if (!authReady(s) || !checkBasicAuth(req.headers.authorization, s!.username, s!.passwordHash)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Errata", charset="UTF-8"',
      'Content-Type': 'text/plain',
    })
    res.end('Authentication required.')
    return
  }
  const proxyReq = request(
    { hostname: state.upstreamHost, port: appPort(), path: req.url, method: req.method, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
      proxyRes.pipe(res)
    },
  )
  proxyReq.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end('Bad gateway: the app is not reachable.')
  })
  req.pipe(proxyReq)
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('error', onError)
      if (err.code === 'EADDRINUSE' && port < SHARE_PORT_MAX) {
        listen(server, port + 1).then(resolve, reject)
      } else {
        reject(err)
      }
    }
    server.on('error', onError)
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onError)
      resolve(port)
    })
  })
}

/** Find which localhost family the app listens on (dev vite is IPv6-only). */
function probeUpstreamHost(port: number): Promise<string> {
  const tryHost = (host: string) => new Promise<boolean>((resolve) => {
    const sock = netConnect({ host, port })
    const finish = (ok: boolean) => { sock.destroy(); resolve(ok) }
    sock.setTimeout(600)
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
    sock.once('timeout', () => finish(false))
  })
  return (async () => {
    for (const host of ['127.0.0.1', '::1']) {
      if (await tryHost(host)) return host
    }
    return '127.0.0.1'
  })()
}

async function startProxy(): Promise<void> {
  if (state.proxy) return
  state.upstreamHost = await probeUpstreamHost(appPort())
  logger.info('Upstream host probed', { host: state.upstreamHost, port: appPort() })
  const server = createServer(handleProxyRequest)
  // Don't let a proxy connection error crash the process.
  server.on('error', (err) => logger.error('Proxy server error', { error: String(err) }))
  const port = await listen(server, SHARE_PORT)
  state.proxy = server
  state.proxyPort = port
  logger.info('Auth proxy listening', { port })
}

function stopProxy(): void {
  if (state.proxy) {
    state.proxy.close()
    state.proxy = null
    state.proxyPort = null
    logger.info('Auth proxy stopped')
  }
}

function stopTunnel(): void {
  if (state.tunnelProc) {
    try { state.tunnelProc.kill() } catch { /* ignore */ }
    state.tunnelProc = null
  }
  state.tunnelUrl = null
  state.tunnelStatus = 'stopped'
  state.tunnelError = null
}

async function startTunnel(dataDir: string): Promise<void> {
  if (state.tunnelProc) return
  if (!state.proxyPort) throw new Error('Proxy must be running before the tunnel')
  state.tunnelStatus = 'downloading'
  state.tunnelError = null
  let bin: string
  try {
    bin = await ensureCloudflared(dataDir)
  } catch (err) {
    state.tunnelStatus = 'error'
    state.tunnelError = err instanceof Error ? err.message : String(err)
    logger.error('cloudflared download failed', { error: state.tunnelError })
    return
  }

  state.tunnelStatus = 'starting'
  const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${state.proxyPort}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  state.tunnelProc = proc

  const onChunk = (chunk: Buffer) => {
    const url = parseTunnelUrl(chunk.toString('utf-8'))
    if (url && state.tunnelUrl !== url) {
      state.tunnelUrl = url
      state.tunnelStatus = 'running'
      logger.info('Tunnel ready', { url })
    }
  }
  proc.stdout?.on('data', onChunk)
  proc.stderr?.on('data', onChunk)
  proc.on('error', (err) => {
    state.tunnelStatus = 'error'
    state.tunnelError = err instanceof Error ? err.message : String(err)
  })
  proc.on('exit', (code) => {
    // Only treat as error if we didn't ask it to stop.
    if (state.tunnelProc === proc) {
      state.tunnelProc = null
      state.tunnelUrl = null
      state.tunnelStatus = code === 0 ? 'stopped' : 'error'
      if (code !== 0) state.tunnelError = `cloudflared exited (${code})`
    }
  })
}

/**
 * Reconcile running services with the persisted config. Idempotent — call after
 * any config change and on server start.
 */
export async function reconcileSharing(dataDir: string): Promise<void> {
  state.dataDir = dataDir
  const sharing = await getSharingConfig(dataDir)
  state.current = sharing

  const wantProxy = authReady(sharing) && (sharing.lanEnabled || sharing.tunnelEnabled)
  const wantTunnel = authReady(sharing) && sharing.tunnelEnabled

  if (wantProxy) await startProxy()
  else { stopTunnel(); stopProxy() }

  if (wantProxy && wantTunnel) {
    if (!state.tunnelProc && state.tunnelStatus !== 'downloading' && state.tunnelStatus !== 'starting') {
      void startTunnel(dataDir)
    }
  } else {
    stopTunnel()
  }
}

export interface SharingStatus {
  authEnabled: boolean
  hasPassword: boolean
  username: string
  lan: { enabled: boolean; running: boolean; url: string | null }
  tunnel: { enabled: boolean; status: TunnelStatus; url: string | null; error: string | null }
}

export async function getSharingStatus(dataDir: string): Promise<SharingStatus> {
  const sharing = await getSharingConfig(dataDir)
  const lanUrl = state.proxyPort && sharing.lanEnabled ? getLanUrl(state.proxyPort) : null
  return {
    authEnabled: sharing.authEnabled,
    hasPassword: !!sharing.passwordHash,
    username: sharing.username,
    lan: { enabled: sharing.lanEnabled, running: !!state.proxy, url: lanUrl },
    tunnel: { enabled: sharing.tunnelEnabled, status: state.tunnelStatus, url: state.tunnelUrl, error: state.tunnelError },
  }
}

/** Stop everything (used on shutdown / tests). */
export function shutdownSharing(): void {
  stopTunnel()
  stopProxy()
}
