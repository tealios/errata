import { describe, it, expect, beforeEach } from 'vitest'
import { PluginRegistry } from '@/server/plugins/registry'
import { registry as fragmentRegistry } from '@/server/fragments/registry'
import type { WritingPlugin } from '@/server/plugins/types'

function makePlugin(name: string, opts: Partial<WritingPlugin> = {}): WritingPlugin {
  return {
    manifest: { name, version: '1.0.0', description: `Plugin ${name}` },
    ...opts,
  }
}

describe('PluginRegistry', () => {
  let pluginReg: PluginRegistry

  beforeEach(() => {
    pluginReg = new PluginRegistry()
  })

  it('registers and retrieves a plugin', () => {
    const plugin = makePlugin('test')
    pluginReg.register(plugin)

    expect(pluginReg.get('test')).toBe(plugin)
    expect(pluginReg.listAll()).toHaveLength(1)
  })

  it('rejects duplicate plugin names', () => {
    pluginReg.register(makePlugin('test'))
    expect(() => pluginReg.register(makePlugin('test'))).toThrow(
      'Plugin "test" is already registered',
    )
  })

  it('getEnabled filters by enabled names', () => {
    pluginReg.register(makePlugin('alpha'))
    pluginReg.register(makePlugin('beta'))
    pluginReg.register(makePlugin('gamma'))

    const enabled = pluginReg.getEnabled(['alpha', 'gamma'])
    expect(enabled).toHaveLength(2)
    expect(enabled.map((p) => p.manifest.name)).toEqual(['alpha', 'gamma'])
  })

  it('getEnabled ignores unknown names', () => {
    pluginReg.register(makePlugin('alpha'))
    const enabled = pluginReg.getEnabled(['alpha', 'nonexistent'])
    expect(enabled).toHaveLength(1)
  })

  it('unregisters a plugin', () => {
    pluginReg.register(makePlugin('test'))
    pluginReg.unregister('test')

    expect(pluginReg.get('test')).toBeUndefined()
    expect(pluginReg.listAll()).toHaveLength(0)
  })

  it('unregister is a no-op for unknown names', () => {
    expect(() => pluginReg.unregister('nonexistent')).not.toThrow()
  })

  it('clear removes all plugins', () => {
    pluginReg.register(makePlugin('a'))
    pluginReg.register(makePlugin('b'))
    pluginReg.clear()

    expect(pluginReg.listAll()).toHaveLength(0)
  })

  it('registers fragment types into the fragment registry', () => {
    const plugin = makePlugin('with-types', {
      fragmentTypes: [
        {
          type: 'timeline',
          prefix: 'tl',
          stickyByDefault: false,
          contextRenderer: (f) => f.content,
          shortlistFields: ['id', 'name', 'description'],
        },
      ],
    })

    pluginReg.register(plugin)

    const typeDef = fragmentRegistry.getType('timeline')
    expect(typeDef).toBeDefined()
    expect(typeDef!.prefix).toBe('tl')

    // Cleanup: unregister to avoid polluting other tests
    pluginReg.unregister('with-types')
    expect(fragmentRegistry.getType('timeline')).toBeUndefined()
  })
})
