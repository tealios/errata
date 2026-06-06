import { Elysia, t } from 'elysia'
import { getSharingConfig, updateSharingConfig } from '../config/storage'
import { hashPassword } from '../sharing/auth'
import { reconcileSharing, getSharingStatus, type SharingStatus } from '../sharing/manager'
import { toQrDataUrl } from '../sharing/network'

interface StatusResponse extends SharingStatus {
  lanQr: string | null
  tunnelQr: string | null
}

async function statusWithQr(dataDir: string): Promise<StatusResponse> {
  const status = await getSharingStatus(dataDir)
  const [lanQr, tunnelQr] = await Promise.all([
    status.lan.url ? toQrDataUrl(status.lan.url) : Promise.resolve(null),
    status.tunnel.url ? toQrDataUrl(status.tunnel.url) : Promise.resolve(null),
  ])
  return { ...status, lanQr, tunnelQr }
}

export function sharingRoutes(dataDir: string) {
  return new Elysia({ detail: { tags: ['Sharing'] } })
    .get('/sharing/status', () => statusWithQr(dataDir), {
      detail: { summary: 'Current sharing/auth status with QR codes' },
    })

    // Enable/disable Basic Auth and set credentials. Disabling auth tears down
    // any LAN/tunnel exposure.
    .post('/sharing/auth', async ({ body, set }) => {
      const cur = await getSharingConfig(dataDir)
      const willHavePassword = body.password ? true : !!cur.passwordHash
      if (body.enabled && !willHavePassword) {
        set.status = 422
        return { error: 'Set a password before enabling authentication.' }
      }
      const patch: Partial<typeof cur> = { authEnabled: body.enabled }
      if (body.username) patch.username = body.username
      if (body.password) patch.passwordHash = hashPassword(body.password)
      if (!body.enabled) { patch.lanEnabled = false; patch.tunnelEnabled = false }
      await updateSharingConfig(dataDir, patch)
      await reconcileSharing(dataDir)
      return statusWithQr(dataDir)
    }, {
      body: t.Object({
        enabled: t.Boolean(),
        username: t.Optional(t.String({ minLength: 1 })),
        password: t.Optional(t.String({ minLength: 1 })),
      }),
    })

    // Toggle LAN exposure (auth proxy on 0.0.0.0). Gated on auth.
    .post('/sharing/lan', async ({ body, set }) => {
      const cur = await getSharingConfig(dataDir)
      if (body.enabled && !(cur.authEnabled && cur.passwordHash)) {
        set.status = 422
        return { error: 'Enable authentication before exposing to the network.' }
      }
      await updateSharingConfig(dataDir, { lanEnabled: body.enabled })
      await reconcileSharing(dataDir)
      return statusWithQr(dataDir)
    }, { body: t.Object({ enabled: t.Boolean() }) })

    // Toggle the cloudflared tunnel. Gated on auth; downloads the binary lazily.
    .post('/sharing/tunnel', async ({ body, set }) => {
      const cur = await getSharingConfig(dataDir)
      if (body.enabled && !(cur.authEnabled && cur.passwordHash)) {
        set.status = 422
        return { error: 'Enable authentication before opening a tunnel.' }
      }
      await updateSharingConfig(dataDir, { tunnelEnabled: body.enabled })
      await reconcileSharing(dataDir)
      return statusWithQr(dataDir)
    }, { body: t.Object({ enabled: t.Boolean() }) })
}
