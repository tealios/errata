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
