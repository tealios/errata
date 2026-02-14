import type { ComponentType } from 'react'
import { registerPluginPanel, type PluginPanelProps } from './plugin-panels'

interface ClientPluginEntryModule {
  pluginName?: string
  panel?: ComponentType<PluginPanelProps>
}

const clientPluginEntries = import.meta.glob<ClientPluginEntryModule>(
  '../../plugins/*/entry.client.ts',
  { eager: true },
)

for (const [path, mod] of Object.entries(clientPluginEntries)) {
  if (!mod.pluginName || !mod.panel) {
    console.warn(`[plugins] Skipping ${path}: entry.client.ts must export pluginName and panel`)
    continue
  }
  registerPluginPanel(mod.pluginName, mod.panel)
}
