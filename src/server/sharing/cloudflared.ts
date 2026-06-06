import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { platform, arch } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download'

export interface CloudflaredAsset {
  url: string
  /** macOS ships a .tgz that must be extracted; others are direct binaries. */
  isTgz: boolean
  binaryName: string
}

/** Resolve the cloudflared release asset for a platform/arch. */
export function cloudflaredAsset(
  plat: NodeJS.Platform = platform(),
  architecture: string = arch(),
): CloudflaredAsset {
  const a = ({ x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' } as Record<string, string>)[architecture] ?? 'amd64'
  if (plat === 'win32') {
    // cloudflared ships windows amd64 + 386 only; arm64 runs under emulation.
    const wa = a === '386' ? '386' : 'amd64'
    return { url: `${BASE}/cloudflared-windows-${wa}.exe`, isTgz: false, binaryName: 'cloudflared.exe' }
  }
  if (plat === 'darwin') {
    const da = a === 'arm64' ? 'arm64' : 'amd64'
    return { url: `${BASE}/cloudflared-darwin-${da}.tgz`, isTgz: true, binaryName: 'cloudflared' }
  }
  return { url: `${BASE}/cloudflared-linux-${a}`, isTgz: false, binaryName: 'cloudflared' }
}

const TUNNEL_RE = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/i

/** Extract the public quick-tunnel URL from cloudflared's log output. */
export function parseTunnelUrl(text: string): string | null {
  const m = text.match(TUNNEL_RE)
  return m ? m[0] : null
}

export function cloudflaredPath(dataDir: string, asset: CloudflaredAsset = cloudflaredAsset()): string {
  return join(dataDir, 'bin', asset.binaryName)
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true } catch { return false }
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`)
  await pipeline(Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest))
}

function extractTgz(tgz: string, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', tgz, '-C', dir], { stdio: 'ignore' })
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))))
  })
}

/**
 * Ensure the cloudflared binary exists under `dataDir/bin`, downloading it for
 * the current platform on first use. Returns the binary path.
 */
export async function ensureCloudflared(
  dataDir: string,
  onProgress?: (stage: 'downloading' | 'extracting' | 'ready') => void,
): Promise<string> {
  const asset = cloudflaredAsset()
  const binDir = join(dataDir, 'bin')
  const binPath = join(binDir, asset.binaryName)
  if (await exists(binPath)) return binPath

  await mkdir(binDir, { recursive: true })
  onProgress?.('downloading')
  if (asset.isTgz) {
    const tgz = join(binDir, 'cloudflared.tgz')
    await downloadTo(asset.url, tgz)
    onProgress?.('extracting')
    await extractTgz(tgz, binDir)
    await rm(tgz, { force: true })
  } else {
    await downloadTo(asset.url, binPath)
  }
  await chmod(binPath, 0o755).catch(() => {})
  onProgress?.('ready')
  return binPath
}
