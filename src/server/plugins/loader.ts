import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { WritingPlugin } from './types'

const SERVER_ENTRY_CANDIDATES = ['entry.server.ts', 'entry.server.js', 'plugin.ts', 'plugin.js']

function resolvePluginEntryPath(pluginsDir: string, name: string): string | null {
  for (const entryFile of SERVER_ENTRY_CANDIDATES) {
    const fullPath = join(pluginsDir, name, entryFile)
    if (existsSync(fullPath)) return fullPath
  }
  return null
}

export async function discoverPlugins(pluginsDir: string): Promise<string[]> {
  if (!existsSync(pluginsDir)) return []

  const entries = await readdir(pluginsDir)
  const names: string[] = []

  for (const entry of entries) {
    const entryPath = join(pluginsDir, entry)
    const entryStat = await stat(entryPath)
    if (!entryStat.isDirectory()) continue

    const pluginEntry = resolvePluginEntryPath(pluginsDir, entry)
    if (pluginEntry) {
      names.push(entry)
    }
  }

  return names
}

export async function loadPlugin(
  pluginsDir: string,
  name: string,
): Promise<WritingPlugin> {
  const pluginPath = resolvePluginEntryPath(pluginsDir, name)
  if (!pluginPath) {
    throw new Error(
      `Plugin "${name}" has no supported server entrypoint (${SERVER_ENTRY_CANDIDATES.join(', ')})`,
    )
  }

  const mod = await import(pathToFileURL(pluginPath).href)
  const plugin: WritingPlugin = mod.default ?? mod.plugin
  if (!plugin || !plugin.manifest) {
    throw new Error(`Plugin "${name}" does not export a valid WritingPlugin in ${pluginPath}`)
  }
  return plugin
}

export async function loadAllPlugins(pluginsDir: string): Promise<WritingPlugin[]> {
  const names = await discoverPlugins(pluginsDir)
  const plugins: WritingPlugin[] = []

  for (const name of names) {
    const plugin = await loadPlugin(pluginsDir, name)
    plugins.push(plugin)
  }

  return plugins
}
