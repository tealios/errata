import type { ComponentType } from 'react'
import { createClientOnlyFn } from '@tanstack/react-start'
import {
  registerClientPlugin,
  type PluginPanelProps,
  type PluginRuntimeContext,
  type PanelEvent,
} from './plugin-panels'

interface ClientPluginEntryModule {
  pluginName?: string
  panel?: ComponentType<PluginPanelProps>
  activate?: (context: PluginRuntimeContext) => void
  deactivate?: (context: PluginRuntimeContext) => void
  onPanelOpen?: (event: PanelEvent, context: PluginRuntimeContext) => void
  onPanelClose?: (event: PanelEvent, context: PluginRuntimeContext) => void
}

const registerPluginEntriesClientOnly = createClientOnlyFn(() => {
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
      onPanelOpen: mod.onPanelOpen,
      onPanelClose: mod.onPanelClose,
    })
  }
})

let pluginPanelsInitialized = false

export function initClientPluginPanels() {
  if (pluginPanelsInitialized) return
  pluginPanelsInitialized = true
  registerPluginEntriesClientOnly()
}
