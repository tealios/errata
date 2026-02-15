import type { ComponentType } from 'react'

export interface PluginPanelProps {
  storyId: string
}

export interface PluginRuntimeContext {
  storyId: string
}

export interface ClientPluginRegistration {
  panel?: ComponentType<PluginPanelProps>
  activate?: (context: PluginRuntimeContext) => void
  deactivate?: (context: PluginRuntimeContext) => void
}

const pluginRegistry = new Map<string, ClientPluginRegistration>()
const activeRuntimePlugins = new Set<string>()
const runtimeContextByPlugin = new Map<string, PluginRuntimeContext>()

export function registerClientPlugin(name: string, registration: ClientPluginRegistration) {
  const existing = pluginRegistry.get(name) ?? {}
  pluginRegistry.set(name, {
    ...existing,
    ...registration,
  })
}

export function registerPluginPanel(
  name: string,
  component: ComponentType<PluginPanelProps>,
) {
  registerClientPlugin(name, { panel: component })
}

export function getPluginPanel(
  name: string,
): ComponentType<PluginPanelProps> | undefined {
  return pluginRegistry.get(name)?.panel
}

export function getAllPluginPanels(): Array<{
  name: string
  component: ComponentType<PluginPanelProps>
}> {
  return Array.from(pluginRegistry.entries())
    .filter(([, entry]) => Boolean(entry.panel))
    .map(([name, entry]) => ({
      name,
      component: entry.panel!,
    }))
}

export function syncClientPluginRuntimes(
  enabledPluginNames: string[],
  context: PluginRuntimeContext,
) {
  const enabledSet = new Set(enabledPluginNames)

  for (const name of Array.from(activeRuntimePlugins)) {
    if (!enabledSet.has(name)) {
      const entry = pluginRegistry.get(name)
      const previousContext = runtimeContextByPlugin.get(name) ?? context
      entry?.deactivate?.(previousContext)
      activeRuntimePlugins.delete(name)
      runtimeContextByPlugin.delete(name)
    }
  }

  for (const name of enabledSet) {
    const entry = pluginRegistry.get(name)
    if (!entry?.activate && !entry?.deactivate) continue

    const previousContext = runtimeContextByPlugin.get(name)
    if (!activeRuntimePlugins.has(name)) {
      entry.activate?.(context)
      activeRuntimePlugins.add(name)
      runtimeContextByPlugin.set(name, context)
      continue
    }

    if (previousContext && previousContext.storyId !== context.storyId) {
      entry.deactivate?.(previousContext)
      entry.activate?.(context)
      runtimeContextByPlugin.set(name, context)
    }
  }
}

export function deactivateAllClientPluginRuntimes() {
  for (const name of Array.from(activeRuntimePlugins)) {
    const entry = pluginRegistry.get(name)
    const context = runtimeContextByPlugin.get(name)
    if (context) {
      entry?.deactivate?.(context)
    }
    activeRuntimePlugins.delete(name)
    runtimeContextByPlugin.delete(name)
  }
}
