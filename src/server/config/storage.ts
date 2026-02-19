import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { GlobalConfigSchema, type GlobalConfig, type ProviderConfig } from './schema'

function configPath(dataDir: string): string {
  return join(dataDir, 'config.json')
}

export async function getGlobalConfig(dataDir: string): Promise<GlobalConfig> {
  try {
    const raw = await fs.readFile(configPath(dataDir), 'utf-8')
    return GlobalConfigSchema.parse(JSON.parse(raw))
  } catch {
    return { providers: [], defaultProviderId: null }
  }
}

export async function saveGlobalConfig(dataDir: string, config: GlobalConfig): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(configPath(dataDir), JSON.stringify(config, null, 2))
}

export async function addProvider(dataDir: string, provider: ProviderConfig): Promise<GlobalConfig> {
  const config = await getGlobalConfig(dataDir)
  config.providers.push(provider)
  // Auto-set as default if it's the first provider
  if (config.providers.length === 1) {
    config.defaultProviderId = provider.id
  }
  await saveGlobalConfig(dataDir, config)
  return config
}

export async function updateProvider(dataDir: string, providerId: string, updates: Partial<Omit<ProviderConfig, 'id' | 'createdAt'>>): Promise<GlobalConfig> {
  const config = await getGlobalConfig(dataDir)
  const idx = config.providers.findIndex((p) => p.id === providerId)
  if (idx === -1) throw new Error(`Provider ${providerId} not found`)
  config.providers[idx] = { ...config.providers[idx], ...updates }
  await saveGlobalConfig(dataDir, config)
  return config
}

export async function deleteProvider(dataDir: string, providerId: string): Promise<GlobalConfig> {
  const config = await getGlobalConfig(dataDir)
  config.providers = config.providers.filter((p) => p.id !== providerId)
  if (config.defaultProviderId === providerId) {
    config.defaultProviderId = config.providers[0]?.id ?? null
  }
  await saveGlobalConfig(dataDir, config)
  return config
}

export async function getProvider(dataDir: string, providerId: string): Promise<ProviderConfig | undefined> {
  const config = await getGlobalConfig(dataDir)
  return config.providers.find((p) => p.id === providerId)
}

export async function duplicateProvider(dataDir: string, providerId: string): Promise<GlobalConfig> {
  const config = await getGlobalConfig(dataDir)
  const source = config.providers.find((p) => p.id === providerId)
  if (!source) throw new Error(`Provider ${providerId} not found`)
  const newId = `prov-${Date.now().toString(36)}`
  const duplicate: ProviderConfig = {
    ...source,
    id: newId,
    name: `${source.name} (copy)`,
    createdAt: new Date().toISOString(),
  }
  config.providers.push(duplicate)
  await saveGlobalConfig(dataDir, config)
  return config
}

export function maskApiKey(key: string): string {
  if (key.length <= 4) return '••••'
  return '••••' + key.slice(-4)
}

export async function getGlobalConfigSafe(dataDir: string): Promise<GlobalConfig> {
  const config = await getGlobalConfig(dataDir)
  return {
    ...config,
    providers: config.providers.map((p) => ({
      ...p,
      apiKey: maskApiKey(p.apiKey),
    })),
  }
}
