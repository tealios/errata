import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { WritingPlugin } from './types'
import { registerRuntimePluginUi } from './runtime-ui'
import { createLogger } from '../logging'

const logger = createLogger('plugin-loader')

const SERVER_ENTRY_CANDIDATES = ['entry.server.ts', 'entry.server.js', 'plugin.ts', 'plugin.js']

interface PluginJsonPanel {
  title?: string
  entry?: string
  showInSidebar?: boolean
  icon?:
    | { type?: 'lucide'; name?: string }
    | { type?: 'svg'; src?: string }
}

interface PluginJson {
  name?: string
  panel?: PluginJsonPanel
}

export interface LoaderOptions {
  /** Whether `.ts` entrypoints can be imported (defaults to runtime detection) */
  typescript?: boolean
}

/** Bun (and test runners) can import .ts directly; plain Node cannot. */
function runtimeSupportsTypeScript(): boolean {
  if (typeof process === 'undefined') return false
  if (process.versions?.bun) return true
  if (process.env.VITEST) return true
  return Boolean((process as { features?: { typescript?: unknown } }).features?.typescript)
}

function resolvePluginEntryPath(
  pluginsDir: string,
  name: string,
  tsSupported: boolean = runtimeSupportsTypeScript(),
): string | null {
  for (const entryFile of SERVER_ENTRY_CANDIDATES) {
    if (!tsSupported && entryFile.endsWith('.ts')) continue
    const fullPath = join(pluginsDir, name, entryFile)
    if (existsSync(fullPath)) return fullPath
  }
  return null
}

export async function discoverPlugins(pluginsDir: string, options: LoaderOptions = {}): Promise<string[]> {
  const tsSupported = options.typescript ?? runtimeSupportsTypeScript()
  if (!existsSync(pluginsDir)) return []

  const entries = await readdir(pluginsDir)
  const names: string[] = []

  for (const entry of entries) {
    const entryPath = join(pluginsDir, entry)
    const entryStat = await stat(entryPath)
    if (!entryStat.isDirectory()) continue

    const pluginEntry = resolvePluginEntryPath(pluginsDir, entry, tsSupported)
    if (pluginEntry) {
      names.push(entry)
    } else if (!tsSupported && resolvePluginEntryPath(pluginsDir, entry, true)) {
      logger.warn(`Skipping plugin "${entry}": it only has a TypeScript entrypoint, which this runtime cannot load (precompile to .js)`, { plugin: entry })
    }
  }

  return names
}

export async function loadPlugin(
  pluginsDir: string,
  name: string,
  options: LoaderOptions = {},
): Promise<WritingPlugin> {
  const pluginPath = resolvePluginEntryPath(pluginsDir, name, options.typescript ?? runtimeSupportsTypeScript())
  if (!pluginPath) {
    throw new Error(
      `Plugin "${name}" has no supported server entrypoint (${SERVER_ENTRY_CANDIDATES.join(', ')})`,
    )
  }

  const mod = await import(
    /* @vite-ignore */
    pathToFileURL(pluginPath).href
  )
  const plugin: WritingPlugin = mod.default ?? mod.plugin
  if (!plugin || !plugin.manifest) {
    throw new Error(`Plugin "${name}" does not export a valid WritingPlugin in ${pluginPath}`)
  }

  const pluginRoot = resolve(join(pluginsDir, name))
  const pluginJsonPath = join(pluginRoot, 'plugin.json')
  if (existsSync(pluginJsonPath)) {
    try {
      const pluginJson = JSON.parse(await readFile(pluginJsonPath, 'utf8')) as PluginJson

      if (pluginJson.name && pluginJson.name !== plugin.manifest.name) {
        throw new Error(
          `plugin.json name (${pluginJson.name}) must match manifest name (${plugin.manifest.name})`,
        )
      }

      const existingPanel = plugin.manifest.panel

      if (pluginJson.panel?.title) {
        plugin.manifest.panel = {
          ...existingPanel,
          title: pluginJson.panel.title,
        }
      }

      if (typeof pluginJson.panel?.showInSidebar === 'boolean') {
        plugin.manifest.panel = {
          title: existingPanel?.title ?? plugin.manifest.name,
          ...existingPanel,
          showInSidebar: pluginJson.panel.showInSidebar,
        }
      }

      const icon = pluginJson.panel?.icon
      if (icon?.type === 'lucide' && icon.name) {
        plugin.manifest.panel = {
          title: existingPanel?.title ?? plugin.manifest.name,
          ...existingPanel,
          icon: { type: 'lucide', name: icon.name },
        }
      }
      if (icon?.type === 'svg' && icon.src) {
        plugin.manifest.panel = {
          title: existingPanel?.title ?? plugin.manifest.name,
          ...existingPanel,
          icon: { type: 'svg', src: icon.src },
        }
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

export async function loadAllPlugins(pluginsDir: string, options: LoaderOptions = {}): Promise<WritingPlugin[]> {
  const names = await discoverPlugins(pluginsDir, options)
  const plugins: WritingPlugin[] = []

  for (const name of names) {
    // One broken plugin must not stop the others from loading.
    try {
      plugins.push(await loadPlugin(pluginsDir, name, options))
    } catch (error) {
      logger.error(`Failed to load plugin "${name}"`, {
        plugin: name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return plugins
}
