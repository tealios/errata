import type { ToolSet } from 'ai'
import type { WritingPlugin } from './types'
import { createLogger } from '../logging'

const logger = createLogger('plugin-tools')

/**
 * Collect tools from plugins. Core tools (`reservedNames`) always win: a plugin
 * tool that collides with a reserved name (or with an earlier plugin's tool) is
 * skipped with a warning.
 */
export function collectPluginTools(
  plugins: WritingPlugin[],
  dataDir: string,
  storyId: string,
  reservedNames: Iterable<string> = [],
): ToolSet {
  return collectPluginToolsWithOrigin(plugins, dataDir, storyId, reservedNames).tools
}

/** Like collectPluginTools but preserves which plugin each tool came from */
export function collectPluginToolsWithOrigin(
  plugins: WritingPlugin[],
  dataDir: string,
  storyId: string,
  reservedNames: Iterable<string> = [],
): { tools: ToolSet; origins: Record<string, string> } {
  const reserved = new Set(reservedNames)
  const tools: ToolSet = {}
  const origins: Record<string, string> = {}
  for (const plugin of plugins) {
    if (!plugin.tools) continue
    const pluginTools = plugin.tools(dataDir, storyId)
    for (const [name, t] of Object.entries(pluginTools)) {
      if (reserved.has(name) || name in tools) {
        logger.warn('Plugin tool name collides with an existing tool; skipping the plugin tool', {
          tool: name,
          plugin: plugin.manifest.name,
          collidesWith: reserved.has(name) ? 'core' : origins[name],
        })
        continue
      }
      tools[name] = t as ToolSet[string]
      origins[name] = plugin.manifest.name
    }
  }
  return { tools, origins }
}
