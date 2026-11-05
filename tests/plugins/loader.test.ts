import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { discoverPlugins, loadPlugin, loadAllPlugins } from '@/server/plugins/loader'

const fixturesDir = join(__dirname, 'fixtures')

describe('discoverPlugins', () => {
  it('returns empty array for nonexistent directory', async () => {
    const names = await discoverPlugins('/nonexistent/path')
    expect(names).toEqual([])
  })

  it('discovers directories with plugin.ts', async () => {
    const names = await discoverPlugins(fixturesDir)
    expect(names).toContain('valid-plugin')
  })

  it('skips directories without plugin.ts', async () => {
    const names = await discoverPlugins(fixturesDir)
    expect(names).not.toContain('no-plugin')
    expect(names).not.toContain('empty-dir')
  })
})

describe('loadPlugin', () => {
  it('loads a valid plugin', async () => {
    const plugin = await loadPlugin(fixturesDir, 'valid-plugin')
    expect(plugin.manifest.name).toBe('valid-plugin')
    expect(plugin.manifest.version).toBe('1.0.0')
  })

  it('throws for nonexistent plugin', async () => {
    await expect(loadPlugin(fixturesDir, 'nonexistent')).rejects.toThrow()
  })
})

describe('loader robustness', () => {
  it('skips .ts-only plugins when TypeScript is unsupported', async () => {
    const names = await discoverPlugins(fixturesDir, { typescript: false })
    expect(names).not.toContain('valid-plugin')
    await expect(loadPlugin(fixturesDir, 'valid-plugin', { typescript: false })).rejects.toThrow()
  })

  it('loadAllPlugins keeps going when one plugin fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugins-'))
    try {
      await mkdir(join(dir, 'a-broken'))
      await writeFile(join(dir, 'a-broken', 'plugin.js'), 'throw new Error("bad plugin")')
      await mkdir(join(dir, 'b-good'))
      await writeFile(
        join(dir, 'b-good', 'plugin.js'),
        "export default { manifest: { name: 'b-good', version: '1.0.0', description: 'ok' } }",
      )
      const plugins = await loadAllPlugins(dir)
      expect(plugins.map(p => p.manifest.name)).toEqual(['b-good'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
