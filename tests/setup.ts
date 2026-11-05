import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoryMeta } from '../src/server/fragments/schema'

type StorySettings = StoryMeta['settings']

/**
 * Creates a default test story settings object.
 * Accepts optional overrides for any field.
 */
export function makeTestSettings(overrides?: Partial<StorySettings>): StorySettings {
  return {
    outputFormat: 'markdown',
    enabledPlugins: [],
    summarizationThreshold: 4,
    maxSteps: 10,
    modelOverrides: {},
    generationMode: 'standard' as const,
    clarifyBeforeGenerate: false,
    prewriterReasoning: 'normal' as const,
    disableLibrarianAutoAnalysis: false,
    autoApplyLibrarianSuggestions: false,
    disableLibrarianDirections: false,
    disableLibrarianSuggestions: false,
    disableThinking: false,
    expandThoughtsByDefault: false,
    contextOrderMode: 'simple',
    fragmentOrder: [],
    customFragmentTypes: [],
    contextCompact: { type: 'proseLimit', value: 10 },
    summaryCompact: { maxCharacters: 12000, targetCharacters: 9000 },
    enableHierarchicalSummary: false,
    ...overrides,
  }
}

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

/** Required global-config fields besides providers, for tests that call saveGlobalConfig directly. */
export const TEST_GLOBAL_CONFIG_DEFAULTS = {
  sharing: { authEnabled: false, username: 'errata', passwordHash: '', lanEnabled: false, tunnelEnabled: false },
  erratanet: { hubUrl: '', token: '', enabled: false, introSeen: false },
}
