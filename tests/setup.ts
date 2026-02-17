import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Creates a temporary directory for test isolation.
 * Returns the path and a cleanup function.
 */
export async function createTempDir(): Promise<{
  path: string
  cleanup: () => Promise<void>
}> {
  const path = await mkdtemp(join(tmpdir(), 'errata-test-'))
  return {
    path,
    cleanup: () => rm(path, { recursive: true, force: true }),
  }
}

/**
 * Writes a minimal provider config to the test data directory.
 * Required because getModel() throws when no provider is configured.
 */
export async function seedTestProvider(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  const config = {
    providers: [{
      id: 'test-provider',
      name: 'Test',
      preset: 'custom',
      baseURL: 'http://localhost:0',
      apiKey: 'test-key',
      defaultModel: 'test-model',
      enabled: true,
      customHeaders: {},
      createdAt: new Date().toISOString(),
    }],
    defaultProviderId: 'test-provider',
  }
  await writeFile(join(dataDir, 'config.json'), JSON.stringify(config))
}
