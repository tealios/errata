import type { WritingPlugin } from './types'
import { registry as fragmentRegistry } from '../fragments/registry'

export class PluginRegistry {
  private plugins = new Map<string, WritingPlugin>()

  register(plugin: WritingPlugin): void {
    const name = plugin.manifest.name
    if (this.plugins.has(name)) {
      throw new Error(`Plugin "${name}" is already registered`)
    }
    this.plugins.set(name, plugin)

    // Register plugin fragment types into the fragment registry
    if (plugin.fragmentTypes) {
      for (const ft of plugin.fragmentTypes) {
        fragmentRegistry.register(ft)
      }
    }
  }

  unregister(name: string): void {
    const plugin = this.plugins.get(name)
    if (!plugin) return

    // Unregister fragment types
    if (plugin.fragmentTypes) {
      for (const ft of plugin.fragmentTypes) {
        fragmentRegistry.unregister(ft.type)
      }
    }

    this.plugins.delete(name)
  }

  get(name: string): WritingPlugin | undefined {
    return this.plugins.get(name)
  }

  listAll(): WritingPlugin[] {
    return [...this.plugins.values()]
  }

  getEnabled(enabledNames: string[]): WritingPlugin[] {
    return enabledNames
      .map((name) => this.plugins.get(name))
      .filter((p): p is WritingPlugin => p !== undefined)
  }

  clear(): void {
    // Unregister fragment types for all plugins
    for (const plugin of this.plugins.values()) {
      if (plugin.fragmentTypes) {
        for (const ft of plugin.fragmentTypes) {
          fragmentRegistry.unregister(ft.type)
        }
      }
    }
    this.plugins.clear()
  }
}

/** Singleton plugin registry instance */
export const pluginRegistry = new PluginRegistry()
