import { resolve } from 'node:path'

export interface RuntimePluginUiConfig {
  pluginName: string
  pluginRoot: string
  entryFile: string
}

const runtimePluginUi = new Map<string, RuntimePluginUiConfig>()

export function clearRuntimePluginUi(): void {
  runtimePluginUi.clear()
}

export function registerRuntimePluginUi(config: RuntimePluginUiConfig): void {
  runtimePluginUi.set(config.pluginName, {
    ...config,
    pluginRoot: resolve(config.pluginRoot),
  })
}

export function getRuntimePluginUi(pluginName: string): RuntimePluginUiConfig | undefined {
  return runtimePluginUi.get(pluginName)
}
