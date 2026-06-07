import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir } from '../setup'
import { createApp } from '@/server/api'
import { GlobalConfigSchema } from '@/server/config/schema'
import { getSharingConfig, updateSharingConfig, getGlobalConfigSafe } from '@/server/config/storage'
import { shutdownSharing } from '@/server/sharing/manager'

describe('sharing config', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
  })
  afterEach(async () => { await cleanup() })

  it('defaults to all-off, opt-in', () => {
    const parsed = GlobalConfigSchema.parse({})
    expect(parsed.sharing).toEqual({ authEnabled: false, username: 'errata', passwordHash: '', lanEnabled: false, tunnelEnabled: false })
  })

  it('round-trips sharing settings through storage', async () => {
    await updateSharingConfig(dataDir, { authEnabled: true, passwordHash: 'salt:hash', lanEnabled: true })
    const s = await getSharingConfig(dataDir)
    expect(s.authEnabled).toBe(true)
    expect(s.lanEnabled).toBe(true)
    expect(s.passwordHash).toBe('salt:hash')
  })

  it('getGlobalConfigSafe redacts the password hash', async () => {
    await updateSharingConfig(dataDir, { passwordHash: 'salt:secrethash' })
    const safe = await getGlobalConfigSafe(dataDir)
    expect(safe.sharing.passwordHash).not.toContain('secrethash')
    expect(safe.sharing.passwordHash).toBe('••••')
  })
})

describe('sharing routes', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>

  async function call(path: string, init?: RequestInit) {
    return app.fetch(new Request(`http://localhost/api${path}`, init))
  }
  const post = (path: string, body: unknown) =>
    call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    app = createApp(dataDir)
  })
  afterEach(async () => { shutdownSharing(); await cleanup() })

  it('status is off by default', async () => {
    const res = await call('/sharing/status')
    expect(res.status).toBe(200)
    const s = await res.json()
    expect(s.authEnabled).toBe(false)
    expect(s.hasPassword).toBe(false)
    expect(s.lan.enabled).toBe(false)
    expect(s.tunnel.enabled).toBe(false)
    expect(s.lanQr).toBeNull()
  })

  it('rejects LAN exposure without auth', async () => {
    const res = await post('/sharing/lan', { enabled: true })
    expect(res.status).toBe(422)
  })

  it('rejects the tunnel without auth', async () => {
    const res = await post('/sharing/tunnel', { enabled: true })
    expect(res.status).toBe(422)
  })

  it('rejects enabling auth without a password', async () => {
    const res = await post('/sharing/auth', { enabled: true })
    expect(res.status).toBe(422)
  })

  it('enables auth with a password and reports hasPassword without leaking it', async () => {
    const res = await post('/sharing/auth', { enabled: true, username: 'me', password: 'pw' })
    expect(res.status).toBe(200)
    const s = await res.json()
    expect(s.authEnabled).toBe(true)
    expect(s.hasPassword).toBe(true)
    expect(s.username).toBe('me')
    expect(JSON.stringify(s)).not.toContain('pw')
    // The persisted hash is real and not the plaintext.
    const stored = await getSharingConfig(dataDir)
    expect(stored.passwordHash).toContain(':')
    expect(stored.passwordHash).not.toContain('pw')
  })

  it('allows toggling auth off (which also clears exposure)', async () => {
    await post('/sharing/auth', { enabled: true, password: 'pw' })
    await updateSharingConfig(dataDir, { lanEnabled: true, tunnelEnabled: true })
    const res = await post('/sharing/auth', { enabled: false })
    expect(res.status).toBe(200)
    const stored = await getSharingConfig(dataDir)
    expect(stored.authEnabled).toBe(false)
    expect(stored.lanEnabled).toBe(false)
    expect(stored.tunnelEnabled).toBe(false)
  })
})
