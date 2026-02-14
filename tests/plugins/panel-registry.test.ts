import { describe, it, expect, beforeEach } from 'vitest'

// We test the registry functions by importing the module fresh each time
// Since the registry is module-level state, we use dynamic imports with cache busting
describe('plugin panel registry', () => {
  let registerPluginPanel: typeof import('@/lib/plugin-panels').registerPluginPanel
  let getPluginPanel: typeof import('@/lib/plugin-panels').getPluginPanel
  let getAllPluginPanels: typeof import('@/lib/plugin-panels').getAllPluginPanels

  beforeEach(async () => {
    // Re-import to get fresh module state
    const mod = await import('@/lib/plugin-panels')
    registerPluginPanel = mod.registerPluginPanel
    getPluginPanel = mod.getPluginPanel
    getAllPluginPanels = mod.getAllPluginPanels
  })

  it('registers and retrieves a panel component', () => {
    const MockComponent = () => null
    registerPluginPanel('test-plugin', MockComponent)

    expect(getPluginPanel('test-plugin')).toBe(MockComponent)
  })

  it('returns undefined for unregistered plugin', () => {
    expect(getPluginPanel('nonexistent')).toBeUndefined()
  })

  it('lists all registered panels', () => {
    const Component1 = () => null
    const Component2 = () => null
    registerPluginPanel('plugin-a', Component1)
    registerPluginPanel('plugin-b', Component2)

    const all = getAllPluginPanels()
    const names = all.map((p) => p.name)
    expect(names).toContain('plugin-a')
    expect(names).toContain('plugin-b')
  })

  it('overwrites existing registration', () => {
    const Original = () => null
    const Replacement = () => null

    registerPluginPanel('overwrite-test', Original)
    registerPluginPanel('overwrite-test', Replacement)

    expect(getPluginPanel('overwrite-test')).toBe(Replacement)
  })
})
