import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { discoverPlugins, loadPlugin } from '@/server/plugins/loader'

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
