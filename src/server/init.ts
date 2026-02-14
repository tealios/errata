import { pluginRegistry } from './plugins/registry'
import { createApp } from './api'
import type { WritingPlugin } from './plugins/types'

// Discover plugins at build time using Vite's import.meta.glob.
// Adding a new plugin only requires creating plugins/<name>/plugin.ts — no edits here.
const pluginModules = import.meta.glob<{ default: WritingPlugin }>(
  '../../plugins/*/plugin.ts',
  { eager: true },
)

// Clear previous registrations (handles Vite HMR re-evaluation)
pluginRegistry.clear()

for (const [path, mod] of Object.entries(pluginModules)) {
  const plugin = mod.default
  if (plugin?.manifest) {
    pluginRegistry.register(plugin)
  } else {
    console.warn(`[plugins] Skipping ${path}: no valid default export`)
  }
}

// Create the app after plugins are loaded, so plugin routes get mounted
export const app = createApp()
