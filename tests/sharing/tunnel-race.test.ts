import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { mockEnsure, mockSpawn } = vi.hoisted(() => ({ mockEnsure: vi.fn(), mockSpawn: vi.fn() }))

vi.mock('@/server/sharing/cloudflared', () => ({
  ensureCloudflared: mockEnsure,
  parseTunnelUrl: (s: string) => {
    const m = s.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i)
    return m ? m[0] : null
  },
  cloudflaredAsset: () => ({ url: '', isTgz: false, binaryName: 'cloudflared' }),
}))

vi.mock('node:child_process', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, spawn: mockSpawn }
})

import { createTempDir } from '../setup'
import { updateSharingConfig } from '@/server/config/storage'
import { reconcileSharing, getSharingStatus, shutdownSharing } from '@/server/sharing/manager'

function fakeProc() {
  return {
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on: () => {},
    kill: () => {},
  }
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms))

describe('sharing tunnel start race', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    vi.clearAllMocks()
    mockSpawn.mockReturnValue(fakeProc())
  })
  afterEach(async () => { shutdownSharing(); await cleanup() })

  it('does not spawn cloudflared if the tunnel is disabled mid-download', async () => {
    await updateSharingConfig(dataDir, { authEnabled: true, passwordHash: 'salt:hash', tunnelEnabled: true })

    let finishDownload!: (path: string) => void
    mockEnsure.mockReturnValue(new Promise<string>((resolve) => { finishDownload = resolve }))

    // Start: proxy comes up and the tunnel download begins (still pending).
    await reconcileSharing(dataDir)
    expect((await getSharingStatus(dataDir)).tunnel.status).toBe('downloading')

    // User disables the tunnel while cloudflared is still downloading.
    await updateSharingConfig(dataDir, { tunnelEnabled: false })
    await reconcileSharing(dataDir)

    // Download now completes — the stale start must NOT spawn a tunnel.
    finishDownload('/fake/cloudflared')
    await tick()

    expect(mockSpawn).not.toHaveBeenCalled()
    expect((await getSharingStatus(dataDir)).tunnel.status).toBe('stopped')
  }, 10000)

  it('spawns cloudflared on the happy path', async () => {
    await updateSharingConfig(dataDir, { authEnabled: true, passwordHash: 'salt:hash', tunnelEnabled: true })
    mockEnsure.mockResolvedValue('/fake/cloudflared')

    await reconcileSharing(dataDir)
    await tick()

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    // It points cloudflared at the local auth proxy.
    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args.join(' ')).toContain('--url')
    expect(args.join(' ')).toContain('http://localhost:')
  }, 10000)
})
