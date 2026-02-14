import type { ComponentType } from 'react'

export interface PluginPanelProps {
  storyId: string
}

const panelRegistry = new Map<string, ComponentType<PluginPanelProps>>()

export function registerPluginPanel(
  name: string,
  component: ComponentType<PluginPanelProps>,
) {
  panelRegistry.set(name, component)
}

export function getPluginPanel(
  name: string,
): ComponentType<PluginPanelProps> | undefined {
  return panelRegistry.get(name)
}

export function getAllPluginPanels(): Array<{
  name: string
  component: ComponentType<PluginPanelProps>
}> {
  return Array.from(panelRegistry.entries()).map(([name, component]) => ({
    name,
    component,
  }))
}
