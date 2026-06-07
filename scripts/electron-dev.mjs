/**
 * Dev launcher for the Electron shell. Starts the Vite dev server, waits for it to come
 * up, bundles the Electron main + preload, then launches Electron pointed at the dev server
 * via ERRATA_DEV_URL (so no Bun sidecar is spawned and HMR works). Kills the dev server when
 * Electron exits.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { get as httpGet } from 'node:http'

const require = createRequire(import.meta.url)
const DEV_URL = process.env.ERRATA_DEV_URL ?? 'http://localhost:7739'
const PORT = Number(new URL(DEV_URL).port || 7739)

function runSync(command, args) {
  const proc = Bun.spawnSync([command, ...args], { stdio: ['inherit', 'inherit', 'inherit'] })
  if (proc.exitCode !== 0) throw new Error(`${command} ${args.join(' ')} failed (${proc.exitCode})`)
}

function waitForHealth(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = httpGet({ host: 'localhost', port, path: '/api/health', timeout: 2_000 }, (res) => {
        res.resume()
        if (res.statusCode === 200) resolve()
        else retry()
      })
      req.on('error', retry)
      req.on('timeout', () => req.destroy())
    }
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('Dev server did not become healthy'))
      else setTimeout(attempt, 400)
    }
    attempt()
  })
}

// Start Vite dev server.
console.log('Starting Vite dev server...')
const dev = spawn('bun', ['run', 'dev'], { stdio: 'inherit', shell: process.platform === 'win32' })

const shutdown = () => {
  if (!dev.killed) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(dev.pid), '/t', '/f'])
    else dev.kill('SIGTERM')
  }
}
process.on('exit', shutdown)
process.on('SIGINT', () => { shutdown(); process.exit(0) })

await waitForHealth(PORT)

// Bundle main + preload for Electron.
for (const entry of ['main', 'preload']) {
  runSync('bun', [
    'build',
    `desktop/${entry}.ts`,
    '--target=node',
    '--format=cjs',
    '--external=electron',
    '--outfile',
    `dist-electron/${entry}.cjs`,
  ])
}

// Launch Electron against the dev server.
const electron = require('electron')
console.log(`Launching Electron -> ${DEV_URL}`)
const app = spawn(electron, ['dist-electron/main.cjs'], {
  stdio: 'inherit',
  env: { ...process.env, ERRATA_DEV_URL: DEV_URL },
})
app.on('exit', (code) => {
  shutdown()
  process.exit(code ?? 0)
})
