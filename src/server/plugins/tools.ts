import type { tool } from 'ai'
import type { WritingPlugin } from './types'

export function collectPluginTools(
  plugins: WritingPlugin[],
  dataDir: string,
  storyId: string,
): Record<string, ReturnType<typeof tool>> {
  const merged: Record<string, ReturnType<typeof tool>> = {}
  for (const plugin of plugins) {
    if (plugin.tools) {
      const tools = plugin.tools(dataDir, storyId)
      Object.assign(merged, tools)
    }
  }
  return merged
}

/** Like collectPluginTools but preserves which plugin each tool came from */
export function collectPluginToolsWithOrigin(
  plugins: WritingPlugin[],
  dataDir: string,
  storyId: string,
): { tools: Record<string, ReturnType<typeof tool>>; origins: Record<string, string> } {
  const tools: Record<string, ReturnType<typeof tool>> = {}
  const origins: Record<string, string> = {}
  for (const plugin of plugins) {
    if (plugin.tools) {
      const pluginTools = plugin.tools(dataDir, storyId)
      for (const [name, t] of Object.entries(pluginTools)) {
        tools[name] = t
        origins[name] = plugin.manifest.name
      }
    }
  }
  return { tools, origins }
}
