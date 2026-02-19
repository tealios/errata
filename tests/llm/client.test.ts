import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'
import { saveGlobalConfig } from '@/server/config/storage'
import { getModel } from '@/server/llm/client'
import type { StoryMeta } from '@/server/fragments/schema'

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings({ librarianProviderId: null, librarianModelId: null, enabledBuiltinTools: [] }),
  }
}

describe('llm client model resolution', () => {
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

  it('uses librarian-specific provider/model when configured', async () => {
    await saveGlobalConfig(dataDir, {
      defaultProviderId: 'gen',
      providers: [
        {
          id: 'gen',
          name: 'Gen Provider',
          preset: 'custom',
          baseURL: 'https://example.com/v1',
          apiKey: 'test-key-gen',
          defaultModel: 'gen-default',
          enabled: true,
          customHeaders: {},
          createdAt: new Date().toISOString(),
        },
        {
          id: 'lib',
          name: 'Lib Provider',
          preset: 'custom',
          baseURL: 'https://example.org/v1',
          apiKey: 'test-key-lib',
          defaultModel: 'lib-default',
          enabled: true,
          customHeaders: {},
          createdAt: new Date().toISOString(),
        },
      ],
    })

    const story = makeStory()
    story.settings.providerId = 'gen'
    story.settings.modelId = 'gen-model'
    story.settings.librarianProviderId = 'lib'
    story.settings.librarianModelId = 'lib-model'
    await createStory(dataDir, story)

    const resolved = await getModel(dataDir, story.id, { role: 'librarian' })
    expect(resolved.providerId).toBe('lib')
    expect(resolved.modelId).toBe('lib-model')
  })

  it('falls back to generation provider/model when librarian settings are unset', async () => {
    await saveGlobalConfig(dataDir, {
      defaultProviderId: 'gen',
      providers: [
        {
          id: 'gen',
          name: 'Gen Provider',
          preset: 'custom',
          baseURL: 'https://example.com/v1',
          apiKey: 'test-key-gen',
          defaultModel: 'gen-default',
          enabled: true,
          customHeaders: {},
          createdAt: new Date().toISOString(),
        },
      ],
    })

    const story = makeStory()
    story.settings.providerId = 'gen'
    story.settings.modelId = 'gen-model'
    await createStory(dataDir, story)

    const resolved = await getModel(dataDir, story.id, { role: 'librarian' })
    expect(resolved.providerId).toBe('gen')
    expect(resolved.modelId).toBe('gen-model')
  })
})
