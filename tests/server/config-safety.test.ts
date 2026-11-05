import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createTempDir } from '../setup'
import { createApp } from '@/server/api'
import {
  getGlobalConfig,
  getGlobalConfigSafe,
  addProvider,
  updateProvider,
  ConfigCorruptError,
} from '@/server/config/storage'
import type { ProviderConfig } from '@/server/config/schema'

let dataDir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
})
afterEach(async () => {
  await cleanup()
})

function provider(id: string): ProviderConfig {
  return {
    id, name: id, preset: 'custom', baseURL: 'https://example.com/v1', apiKey: 'sk-secret-1234',
    defaultModel: 'm', enabled: true, customHeaders: {}, createdAt: new Date().toISOString(),
  } as ProviderConfig
}

describe('global config storage safety', () => {
  it('returns defaults only when the file is missing', async () => {
    const cfg = await getGlobalConfig(dataDir)
    expect(cfg.providers).toEqual([])
  })

  it('refuses to fall back to defaults on a corrupt file, backs it up, and never overwrites it', async () => {
    const bad = '{"providers": [ {"id": "p1", '
    await writeFile(join(dataDir, 'config.json'), bad)
    await expect(getGlobalConfig(dataDir)).rejects.toBeInstanceOf(ConfigCorruptError)
    await expect(addProvider(dataDir, provider('prov-a'))).rejects.toBeInstanceOf(ConfigCorruptError)

    expect(await readFile(join(dataDir, 'config.json'), 'utf-8')).toBe(bad)
    const backups = (await readdir(dataDir)).filter((f) => f.startsWith('config.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(dataDir, backups[0]), 'utf-8')).toBe(bad)

    // Display path still boots with defaults.
    const safe = await getGlobalConfigSafe(dataDir)
    expect(safe.providers).toEqual([])
  })

  it('serializes concurrent provider writes', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => addProvider(dataDir, provider(`prov-${i}`))))
    const cfg = await getGlobalConfig(dataDir)
    expect(cfg.providers).toHaveLength(10)
  })

  it('PUT/duplicate on unknown provider is 404, bad POST body is 400', async () => {
    const app = createApp(dataDir)
    const put = await app.fetch(new Request('http://localhost/api/config/providers/prov-nope', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
    }))
    expect(put.status).toBe(404)
    const dup = await app.fetch(new Request('http://localhost/api/config/providers/prov-nope/duplicate', { method: 'POST' }))
    expect(dup.status).toBe(404)
    const bad = await app.fetch(new Request('http://localhost/api/config/providers', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', baseURL: 'not a url', apiKey: 'k', defaultModel: 'm' }),
    }))
    expect(bad.status).toBe(400)
    await expect(updateProvider(dataDir, 'prov-nope', {})).rejects.toThrow(/not found/)
  })
})
