import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { WritingPlugin } from './types'
import { registerRuntimePluginUi } from './runtime-ui'

const SERVER_ENTRY_CANDIDATES = ['entry.server.ts', 'entry.server.js', 'plugin.ts', 'plugin.js']

interface PluginJsonPanel {
  title?: string
  entry?: string
}

interface PluginJson {
  name?: string
  panel?: PluginJsonPanel
}

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

  const pluginRoot = resolve(join(pluginsDir, name))
  const pluginJsonPath = join(pluginRoot, 'plugin.json')
  if (existsSync(pluginJsonPath)) {
    try {
      const pluginJson = JSON.parse(await Bun.file(pluginJsonPath).text()) as PluginJson

      if (pluginJson.name && pluginJson.name !== plugin.manifest.name) {
        throw new Error(
          `plugin.json name (${pluginJson.name}) must match manifest name (${plugin.manifest.name})`,
        )
      }

      if (pluginJson.panel?.title) {
        plugin.manifest.panel = { title: pluginJson.panel.title }
      }

      if (pluginJson.panel?.entry) {
        registerRuntimePluginUi({
          pluginName: plugin.manifest.name,
          pluginRoot,
          entryFile: pluginJson.panel.entry,
        })
      }
    } catch (error) {
      throw new Error(`Invalid plugin.json for plugin "${name}": ${String(error)}`)
    }
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
