/**
 * Sidecar lifecycle: Errata's HTTP server is the existing Bun-compiled binary. The
 * Electron main process spawns it as a child, bound to localhost on an ephemeral port,
 * with its data directory pointed at the OS userData path. The renderer then loads the
 * server over http://127.0.0.1:<port>.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { get as httpGet } from 'node:http'
import { app } from 'electron'

export interface SidecarHandle {
  port: number
  child: ChildProcess
  stop: () => void
}

/** Ask the OS for a free TCP port by binding to 0 on loopback, then releasing it. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const { port } = addr
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('Could not determine a free port')))
      }
    })
  })
}

/**
 * Locate the bundled Bun binary. Packaged: copied via extraResources into
 * <resources>/server. Dev: produced by `bun run build-electron` into dist/server.
 */
function resolveBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'errata.exe' : 'errata'
  const base = app.isPackaged
    ? join(process.resourcesPath, 'server')
    : join(app.getAppPath(), 'dist', 'server')
  return join(base, binaryName)
}

/** Poll /api/health until the server answers 200 or the timeout elapses. */
function waitForHealth(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = httpGet(
        { host: '127.0.0.1', port, path: '/api/health', timeout: 2_000 },
        (res) => {
          res.resume()
          if (res.statusCode === 200) return resolve()
          retry()
        },
      )
      req.on('error', retry)
      req.on('timeout', () => req.destroy())
    }
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Errata server did not become healthy within ${timeoutMs}ms`))
        return
      }
      setTimeout(attempt, 250)
    }
    attempt()
  })
}

/** Kill the child process tree. taskkill is needed on Windows to reap descendants. */
function killTree(child: ChildProcess) {
  if (!child.pid || child.killed) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
    } catch {
      /* best effort */
    }
  } else {
    try {
      child.kill('SIGTERM')
    } catch {
      /* best effort */
    }
  }
}

export interface StartSidecarOptions {
  /** Called if the server process exits before stop() was requested. */
  onUnexpectedExit?: (code: number | null) => void
}

export async function startSidecar(options: StartSidecarOptions = {}): Promise<SidecarHandle> {
  const binaryPath = resolveBinaryPath()
  if (!existsSync(binaryPath)) {
    throw new Error(
      `Errata server binary not found at ${binaryPath}. Run "bun run build-electron" first.`,
    )
  }

  // extraResources can drop the executable bit on macOS/Linux; restore it.
  if (process.platform !== 'win32') {
    try {
      chmodSync(binaryPath, 0o755)
    } catch {
      /* may already be executable */
    }
  }

  const port = await findFreePort()
  const dataDir = join(app.getPath('userData'), 'data')

  const child = spawn(binaryPath, [], {
    cwd: dirname(binaryPath),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Nitro reads NITRO_PORT/PORT and NITRO_HOST/HOST. Bind loopback only.
      PORT: String(port),
      NITRO_PORT: String(port),
      HOST: '127.0.0.1',
      NITRO_HOST: '127.0.0.1',
      DATA_DIR: dataDir,
    },
  })

  child.stdout?.on('data', (d) => process.stdout.write(`[errata] ${d}`))
  child.stderr?.on('data', (d) => process.stderr.write(`[errata] ${d}`))

  let stopped = false
  child.on('exit', (code) => {
    if (!stopped) options.onUnexpectedExit?.(code)
  })

  const stop = () => {
    stopped = true
    killTree(child)
  }

  try {
    await waitForHealth(port)
  } catch (err) {
    stop()
    throw err
  }

  return { port, child, stop }
}
