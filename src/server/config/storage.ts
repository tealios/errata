import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { GlobalConfigSchema, type GlobalConfig, type ProviderConfig, type SharingConfig, type ErratanetConfig } from './schema'
import { writeJsonAtomic } from '../fs-utils'
import { withKeyLock } from '../async-lock'

function configPath(dataDir: string): string {
  return join(dataDir, 'config.json')
}

/** Thrown when config.json exists but can't be parsed / validated. */
export class ConfigCorruptError extends Error {
  readonly backupPath: string | null
  constructor(message: string, backupPath: string | null) {
    super(message)
    this.name = 'ConfigCorruptError'
    this.backupPath = backupPath
  }
}

export class ProviderNotFoundError extends Error {
  constructor(providerId: string) {
    super(`Provider ${providerId} not found`)
    this.name = 'ProviderNotFoundError'
  }
}

const backedUp = new Map<string, string | null>()

/** Copy an unreadable config aside (once per distinct content) so it can't be lost. */
async function backupCorruptConfig(path: string, raw: string): Promise<string | null> {
  const key = createHash('sha1').update(path).update(raw).digest('hex')
  if (backedUp.has(key)) return backedUp.get(key) ?? null
  const backupPath = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
  let result: string | null = backupPath
  try {
    await fs.writeFile(backupPath, raw, 'utf-8')
  } catch {
    result = null
  }
  backedUp.set(key, result)
  return result
}

/**
 * Read the global config. A missing file yields defaults. Any other failure
 * (corrupt JSON, schema mismatch, unreadable file) throws rather than silently
 * returning defaults - otherwise the next save would overwrite the user's
 * providers and API keys with an empty config. Corrupt files are first copied
 * to `config.json.corrupt-<timestamp>`.
 */
export async function getGlobalConfig(dataDir: string): Promise<GlobalConfig> {
  const path = configPath(dataDir)
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return GlobalConfigSchema.parse({})
    throw err
  }
  try {
    return GlobalConfigSchema.parse(JSON.parse(raw))
  } catch (err) {
    const backupPath = await backupCorruptConfig(path, raw)
    throw new ConfigCorruptError(
      `config.json is invalid (${err instanceof Error ? err.message.slice(0, 200) : 'parse error'})` +
        (backupPath ? `; a copy was saved to ${backupPath}` : ''),
      backupPath,
    )
  }
}

/**
 * Read-only variant for display paths and server boot: falls back to defaults
 * when the file is corrupt so the app still starts, but never writes. Every
 * write path goes through getGlobalConfig and therefore refuses to run.
 */
async function getGlobalConfigForRead(dataDir: string): Promise<GlobalConfig> {
  try {
    return await getGlobalConfig(dataDir)
  } catch (err) {
    if (err instanceof ConfigCorruptError) return GlobalConfigSchema.parse({})
    throw err
  }
}

/** Locked read-modify-write of the whole config. */
export function updateGlobalConfig(
  dataDir: string,
  mutate: (config: GlobalConfig) => void | Promise<void>,
): Promise<GlobalConfig> {
  return withKeyLock(`config:${dataDir}`, async () => {
    const config = await getGlobalConfig(dataDir)
    await mutate(config)
    await saveGlobalConfig(dataDir, config)
    return config
  })
}

export async function getSharingConfig(dataDir: string): Promise<SharingConfig> {
  return (await getGlobalConfigForRead(dataDir)).sharing
}

export async function updateSharingConfig(dataDir: string, patch: Partial<SharingConfig>): Promise<SharingConfig> {
  const config = await updateGlobalConfig(dataDir, (c) => {
    c.sharing = { ...c.sharing, ...patch }
  })
  return config.sharing
}

export async function getErratanetConfig(dataDir: string): Promise<ErratanetConfig> {
  return (await getGlobalConfigForRead(dataDir)).erratanet
}

export async function updateErratanetConfig(dataDir: string, patch: Partial<ErratanetConfig>): Promise<ErratanetConfig> {
  const config = await updateGlobalConfig(dataDir, (c) => {
    c.erratanet = { ...c.erratanet, ...patch }
  })
  return config.erratanet
}

export async function saveGlobalConfig(dataDir: string, config: GlobalConfig): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })
  await writeJsonAtomic(configPath(dataDir), config)
}

export async function addProvider(dataDir: string, provider: ProviderConfig): Promise<GlobalConfig> {
  return updateGlobalConfig(dataDir, (config) => {
    config.providers.push(provider)
    // Auto-set as default if it's the first provider
    if (config.providers.length === 1) {
      config.defaultProviderId = provider.id
    }
  })
}

export async function updateProvider(dataDir: string, providerId: string, updates: Partial<Omit<ProviderConfig, 'id' | 'createdAt'>>): Promise<GlobalConfig> {
  return updateGlobalConfig(dataDir, (config) => {
    const idx = config.providers.findIndex((p) => p.id === providerId)
    if (idx === -1) throw new ProviderNotFoundError(providerId)
    config.providers[idx] = { ...config.providers[idx], ...updates }
  })
}

export async function deleteProvider(dataDir: string, providerId: string): Promise<GlobalConfig> {
  return updateGlobalConfig(dataDir, (config) => {
    config.providers = config.providers.filter((p) => p.id !== providerId)
    if (config.defaultProviderId === providerId) {
      config.defaultProviderId = config.providers[0]?.id ?? null
    }
  })
}

export async function getProvider(dataDir: string, providerId: string): Promise<ProviderConfig | undefined> {
  const config = await getGlobalConfig(dataDir)
  return config.providers.find((p) => p.id === providerId)
}

export async function duplicateProvider(dataDir: string, providerId: string): Promise<GlobalConfig> {
  return updateGlobalConfig(dataDir, (config) => {
    const source = config.providers.find((p) => p.id === providerId)
    if (!source) throw new ProviderNotFoundError(providerId)
    const newId = `prov-${Date.now().toString(36)}`
    const duplicate: ProviderConfig = {
      ...source,
      id: newId,
      name: `${source.name} (copy)`,
      createdAt: new Date().toISOString(),
    }
    config.providers.push(duplicate)
  })
}

export function maskApiKey(key: string): string {
  if (key.length <= 4) return '••••'
  return '••••' + key.slice(-4)
}

export async function getGlobalConfigSafe(dataDir: string): Promise<GlobalConfig> {
  const config = await getGlobalConfigForRead(dataDir)
  return {
    ...config,
    providers: config.providers.map((p) => ({
      ...p,
      apiKey: maskApiKey(p.apiKey),
    })),
    // Never expose the password hash to clients.
    sharing: { ...config.sharing, passwordHash: config.sharing.passwordHash ? '••••' : '' },
    // Never expose the hub token to clients.
    erratanet: { ...config.erratanet, token: config.erratanet.token ? '••••' : '' },
  }
}
