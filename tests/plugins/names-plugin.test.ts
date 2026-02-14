import { describe, it, expect, afterEach } from 'vitest'
import { pluginRegistry } from '@/server/plugins/registry'

describe('names plugin', () => {
  afterEach(() => {
    pluginRegistry.clear()
  })

  it('loads and has correct manifest', async () => {
    const mod = await import('../../plugins/names/plugin')
    const plugin = mod.default
    expect(plugin.manifest.name).toBe('names')
    expect(plugin.manifest.version).toBe('1.0.0')
  })

  it('provides generateName tool', async () => {
    const mod = await import('../../plugins/names/plugin')
    const plugin = mod.default
    const tools = plugin.tools!('/data', 'story-1')
    expect(tools).toHaveProperty('generateName')
  })

  it('generateName tool returns a name', async () => {
    const mod = await import('../../plugins/names/plugin')
    const plugin = mod.default
    const tools = plugin.tools!('/data', 'story-1')
    const generateName = tools.generateName as any

    const result = await generateName.execute({ theme: 'fantasy', gender: 'female' })
    expect(result.name).toBeDefined()
    expect(result.theme).toBe('fantasy')
    expect(result.gender).toBe('female')
    expect(['Elowen', 'Seraphina', 'Isolde', 'Lyra', 'Freya']).toContain(result.name)
  })

  it('has panel metadata in manifest', async () => {
    const mod = await import('../../plugins/names/plugin')
    const plugin = mod.default
    expect(plugin.manifest.panel).toEqual({ title: 'Names' })
  })

  it('POST /generate returns a name', async () => {
    const mod = await import('../../plugins/names/plugin')
    const plugin = mod.default

    const { Elysia } = await import('elysia')
    const testApp = new Elysia()
    plugin.routes!(testApp)

    const res = await testApp.fetch(
      new Request('http://localhost/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'fantasy', gender: 'male' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string; theme: string; gender: string }
    expect(body.name).toBeDefined()
    expect(body.theme).toBe('fantasy')
    expect(body.gender).toBe('male')
    expect(['Aldric', 'Theron', 'Caelum', 'Orin', 'Fenris']).toContain(body.name)
  })

  it('POST /generate returns 400 for invalid theme', async () => {
    const mod = await import('../../plugins/names/plugin')
    const plugin = mod.default

    const { Elysia } = await import('elysia')
    const testApp = new Elysia()
    plugin.routes!(testApp)

    const res = await testApp.fetch(
      new Request('http://localhost/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'nonexistent', gender: 'male' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('provides routes with /themes endpoint', async () => {
    const mod = await import('../../plugins/names/plugin')
    const plugin = mod.default

    pluginRegistry.register(plugin)

    // Create a mini app to test routes
    const { Elysia } = await import('elysia')
    const testApp = new Elysia()
    plugin.routes!(testApp)

    const res = await testApp.fetch(new Request('http://localhost/themes'))
    expect(res.status).toBe(200)
    const body = await res.json() as { themes: string[] }
    expect(body.themes).toContain('fantasy')
    expect(body.themes).toContain('scifi')
    expect(body.themes).toContain('historical')
  })
})
