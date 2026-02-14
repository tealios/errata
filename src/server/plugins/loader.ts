import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { pluginRegistry } from './registry'
import type { WritingPlugin } from './types'

export async function discoverPlugins(pluginsDir: string): Promise<string[]> {
  if (!existsSync(pluginsDir)) return []

  const entries = await readdir(pluginsDir)
  const names: string[] = []

  for (const entry of entries) {
    const entryPath = join(pluginsDir, entry)
    const entryStat = await stat(entryPath)
    if (!entryStat.isDirectory()) continue

    const pluginFile = join(entryPath, 'plugin.ts')
    if (existsSync(pluginFile)) {
      names.push(entry)
    }
  }

  return names
}

export async function loadPlugin(
  pluginsDir: string,
  name: string,
): Promise<WritingPlugin> {
  const pluginPath = join(pluginsDir, name, 'plugin.ts')
  const mod = await import(pluginPath)
  const plugin: WritingPlugin = mod.default ?? mod.plugin
  if (!plugin || !plugin.manifest) {
    throw new Error(`Plugin "${name}" does not export a valid WritingPlugin`)
  }
  return plugin
}

export async function loadAllPlugins(pluginsDir: string): Promise<WritingPlugin[]> {
  const names = await discoverPlugins(pluginsDir)
  const plugins: WritingPlugin[] = []

  for (const name of names) {
    const plugin = await loadPlugin(pluginsDir, name)
    pluginRegistry.register(plugin)
    plugins.push(plugin)
  }

  return plugins
}
