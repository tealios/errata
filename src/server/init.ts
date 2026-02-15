import { pluginRegistry } from './plugins/registry'
import { loadAllPlugins } from './plugins/loader'
import { createApp } from './api'
import type { WritingPlugin } from './plugins/types'

// Discover plugins at build time using Vite's import.meta.glob.
// Adding a new plugin only requires creating plugins/<name>/entry.server.ts — no edits here.
const pluginModules = import.meta.glob<{ default: WritingPlugin }>(
  '../../plugins/*/entry.server.ts',
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

const externalPluginsDir = process.env.PLUGIN_DIR?.trim()
const allowExternalOverride = process.env.PLUGIN_EXTERNAL_OVERRIDE === '1'

if (externalPluginsDir) {
  try {
    const loaded = await loadAllPlugins(externalPluginsDir)

    let registeredExternal = 0
    let skippedExternal = 0

    for (const plugin of loaded) {
      const existing = pluginRegistry.get(plugin.manifest.name)
      if (existing) {
        if (!allowExternalOverride) {
          skippedExternal++
          console.warn(
            `[plugins] Skipping external plugin "${plugin.manifest.name}" from ${externalPluginsDir}: already registered (set PLUGIN_EXTERNAL_OVERRIDE=1 to replace)`,
          )
          continue
        }

        pluginRegistry.unregister(plugin.manifest.name)
      }

      pluginRegistry.register(plugin)
      registeredExternal++
    }

    console.info(
      `[plugins] Loaded ${registeredExternal} external plugin(s) from ${externalPluginsDir}${skippedExternal ? `, skipped ${skippedExternal}` : ''}`,
    )
  } catch (error) {
    console.error(
      `[plugins] Failed to load external plugins from ${externalPluginsDir}:`,
      error,
    )
  }
}

console.info(
  `[plugins] Registered ${pluginRegistry.listAll().length} total plugin(s): ${pluginRegistry
    .listAll()
    .map((p) => p.manifest.name)
    .join(', ') || 'none'}`,
)

// Create the app after plugins are loaded, so plugin routes get mounted
export const app = createApp()
