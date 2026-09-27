import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createTempDir } from '../setup'
import { assembleMobileWww, productionBuildEnv } from '../../scripts/build-android.mjs'

const REPO_ROOT = resolve(__dirname, '..', '..')

describe('assembleMobileWww', () => {
  let tmp: string
  let cleanup: () => Promise<void>
  let outputDir: string
  let wwwDir: string

  beforeEach(async () => {
    const dir = await createTempDir()
    tmp = dir.path
    cleanup = dir.cleanup
    outputDir = join(tmp, '.output')
    wwwDir = join(tmp, 'www')
    await mkdir(join(outputDir, 'server', '_libs'), { recursive: true })
    await mkdir(join(outputDir, 'public', 'assets'), { recursive: true })
    await writeFile(join(outputDir, 'server', 'index.mjs'), 'export {}\n')
    await writeFile(join(outputDir, 'server', '_libs', 'elysia.mjs'), 'export {}\n')
    await writeFile(join(outputDir, 'public', 'assets', 'main.js'), '// client\n')
    await writeFile(join(outputDir, 'nitro.json'), '{"preset":"node-server"}\n')
  })

  afterEach(async () => {
    await cleanup()
  })

  it('lays out the loader page and a bootable node project', async () => {
    await assembleMobileWww({ root: REPO_ROOT, outputDir, wwwDir })

    expect((await readdir(wwwDir)).sort()).toEqual(['index.html', 'nodejs', 'webspeech-shim.js'])
    // Injected by MainActivity so read-aloud works in the Android WebView (no Web Speech API there).
    expect(await readFile(join(wwwDir, 'webspeech-shim.js'), 'utf8')).toContain('ErrataNativeTts')
    const html = await readFile(join(wwwDir, 'index.html'), 'utf8')
    expect(html).toContain('errata:status')

    const pkg = JSON.parse(await readFile(join(wwwDir, 'nodejs', 'package.json'), 'utf8'))
    expect(pkg.main).toBe('main.cjs')
    const repoPkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'))
    expect(pkg.version).toBe(repoPkg.version)

    const expectedFiles = [
      'main.cjs',
      'boot.cjs',
      'nitro.json',
      join('server', 'index.mjs'),
      join('server', '_libs', 'elysia.mjs'),
      join('public', 'assets', 'main.js'),
    ]
    for (const file of expectedFiles) {
      expect((await stat(join(wwwDir, 'nodejs', file))).isFile()).toBe(true)
    }
  })

  it('starts from a clean www so stale chunks do not ship', async () => {
    await mkdir(join(wwwDir, 'nodejs', 'server'), { recursive: true })
    await writeFile(join(wwwDir, 'nodejs', 'server', 'old-chunk.mjs'), '')
    await writeFile(join(wwwDir, 'stale.txt'), '')

    await assembleMobileWww({ root: REPO_ROOT, outputDir, wwwDir })

    await expect(stat(join(wwwDir, 'stale.txt'))).rejects.toThrow()
    await expect(stat(join(wwwDir, 'nodejs', 'server', 'old-chunk.mjs'))).rejects.toThrow()
  })

  it('refuses to assemble without a server bundle', async () => {
    await expect(assembleMobileWww({ root: REPO_ROOT, outputDir: join(tmp, 'nope'), wwwDir })).rejects.toThrow(
      /bun run build/,
    )
  })

  it('refuses a server bundle built in development JSX mode', async () => {
    // A leaked NODE_ENV=development makes vite emit jsxDEV calls, which crash on boot
    // against React's production runtime (jsxDEV is undefined there).
    await mkdir(join(outputDir, 'server', '_ssr'), { recursive: true })
    await writeFile(join(outputDir, 'server', '_ssr', 'router.mjs'), 'jsxDevRuntimeExports.jsxDEV("div", {})\n')
    await expect(assembleMobileWww({ root: REPO_ROOT, outputDir, wwwDir })).rejects.toThrow(/NODE_ENV/)
  })
})

describe('productionBuildEnv', () => {
  it('forces NODE_ENV=production over an inherited development value', () => {
    const env = productionBuildEnv({ NODE_ENV: 'development', PATH: '/bin' })
    expect(env.NODE_ENV).toBe('production')
    expect(env.PATH).toBe('/bin')
  })
})
