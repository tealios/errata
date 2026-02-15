import type { ComponentType } from 'react'
import {
  registerClientPlugin,
  type PluginPanelProps,
  type PluginRuntimeContext,
} from './plugin-panels'

interface ClientPluginEntryModule {
  pluginName?: string
  panel?: ComponentType<PluginPanelProps>
  activate?: (context: PluginRuntimeContext) => void
  deactivate?: (context: PluginRuntimeContext) => void
}

const clientPluginEntries = import.meta.glob<ClientPluginEntryModule>(
  '../../plugins/*/entry.client.ts',
  { eager: true },
)

for (const [path, mod] of Object.entries(clientPluginEntries)) {
  if (!mod.pluginName) {
    console.warn(`[plugins] Skipping ${path}: entry.client.ts must export pluginName`)
    continue
  }
  if (!mod.panel && !mod.activate && !mod.deactivate) {
    console.warn(`[plugins] Skipping ${path}: entry.client.ts must export panel or runtime hooks`) 
    continue
  }

  registerClientPlugin(mod.pluginName, {
    panel: mod.panel,
    activate: mod.activate,
    deactivate: mod.deactivate,
  })
}
