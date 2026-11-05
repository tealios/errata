import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings, TEST_GLOBAL_CONFIG_DEFAULTS } from '../setup'
import { createStory, createFragment, getFragment } from '@/server/fragments/storage'
import { saveGlobalConfig } from '@/server/config/storage'
import { getModel } from '@/server/llm/client'
import { expandFragmentTags } from '@/server/llm/context-builder'
import { withKeyLock } from '@/server/async-lock'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings({ librarianProviderId: null, librarianModelId: null }),
    ...overrides,
  }
}

function makeFragment(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'kn-dollar',
    type: 'knowledge',
    name: 'Treasure',
    description: 'A note',
    content: 'placeholder',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user' as const,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    ...overrides,
  }
}

describe('async-lock: withKeyLock', () => {
  it('serializes critical sections sharing a key', async () => {
    const order: string[] = []
    const a = withKeyLock('k', async () => {
      order.push('a-start')
      await new Promise((r) => setTimeout(r, 20))
      order.push('a-end')
    })
    const b = withKeyLock('k', async () => {
      order.push('b-start')
      order.push('b-end')
    })
    await Promise.all([a, b])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('releases the lock even when a holder rejects', async () => {
    const order: string[] = []
    const a = withKeyLock('k2', async () => {
      order.push('a')
      throw new Error('boom')
    }).catch(() => {})
    const b = withKeyLock('k2', async () => {
      order.push('b')
    })
    await Promise.all([a, b])
    expect(order).toEqual(['a', 'b'])
  })

  it('runs different keys concurrently', async () => {
    const order: string[] = []
    const a = withKeyLock('x', async () => {
      order.push('x-start')
      await new Promise((r) => setTimeout(r, 20))
      order.push('x-end')
    })
    const b = withKeyLock('y', async () => {
      order.push('y-start')
      order.push('y-end')
    })
    await Promise.all([a, b])
    // y finishes before x because they don't share a lock
    expect(order.indexOf('y-end')).toBeLessThan(order.indexOf('x-end'))
  })
})

describe('createFragment overwrite guard', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-test'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await createStory(dataDir, makeStory())
  })

  afterEach(async () => {
    await cleanup()
  })

  it('refuses to clobber an existing fragment by default', async () => {
    const frag = makeFragment({ id: 'kn-secret', content: 'first' })
    await createFragment(dataDir, storyId, frag)
    await expect(
      createFragment(dataDir, storyId, { ...frag, content: 'second' }),
    ).rejects.toThrow(/already exists/)
    const stored = await getFragment(dataDir, storyId, 'kn-secret')
    expect(stored?.content).toBe('first')
  })

  it('overwrites when overwrite: true is passed', async () => {
    const frag = makeFragment({ id: 'kn-secret', content: 'first' })
    await createFragment(dataDir, storyId, frag)
    await createFragment(dataDir, storyId, { ...frag, content: 'second' }, { overwrite: true })
    const stored = await getFragment(dataDir, storyId, 'kn-secret')
    expect(stored?.content).toBe('second')
  })
})

describe('expandFragmentTags is $-safe', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-test'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await createStory(dataDir, makeStory())
  })

  afterEach(async () => {
    await cleanup()
  })

  it('does not interpret $-sequences in fragment content as replacement patterns', async () => {
    // Content with replacement-pattern specials: $&, $1, $$.
    await createFragment(
      dataDir,
      storyId,
      makeFragment({ id: 'kn-dollar', content: 'Cost is $5 plus $& and $$ total' }),
    )
    const out = await expandFragmentTags('See <@kn-dollar> here', dataDir, storyId)
    // Tag expanded...
    expect(out).not.toContain('<@kn-dollar>')
    // ...and the literal $-sequences survive verbatim (not mangled into the match).
    expect(out).toContain('$5')
    expect(out).toContain('$&')
    expect(out).toContain('$$')
  })
})

describe('getModel provider fallback', () => {
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

  it('falls back to the global default when the story provider is disabled', async () => {
    await saveGlobalConfig(dataDir, {
      defaultProviderId: 'def',
      ...TEST_GLOBAL_CONFIG_DEFAULTS,
      providers: [
        {
          id: 'old',
          name: 'Old Provider',
          preset: 'custom',
          baseURL: 'https://old.example/v1',
          apiKey: 'k-old',
          defaultModel: 'old-default',
          enabled: false, // disabled — story still references it
          customHeaders: {},
          temperature: undefined,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'def',
          name: 'Default Provider',
          preset: 'custom',
          baseURL: 'https://def.example/v1',
          apiKey: 'k-def',
          defaultModel: 'def-default',
          enabled: true,
          customHeaders: {},
          temperature: undefined,
          createdAt: new Date().toISOString(),
        },
      ],
    })

    const story = makeStory()
    story.settings.providerId = 'old'
    story.settings.modelId = 'old-model'
    await createStory(dataDir, story)

    const resolved = await getModel(dataDir, story.id, { role: 'generation' })
    // Falls back to the default provider, and its model (the story's modelId
    // belonged to the now-unusable provider).
    expect(resolved.providerId).toBe('def')
    expect(resolved.modelId).toBe('def-default')
  })

  it('still throws when no provider is usable', async () => {
    await saveGlobalConfig(dataDir, {
      defaultProviderId: null,
      ...TEST_GLOBAL_CONFIG_DEFAULTS,
      providers: [
        {
          id: 'old',
          name: 'Old Provider',
          preset: 'custom',
          baseURL: 'https://old.example/v1',
          apiKey: 'k-old',
          defaultModel: 'old-default',
          enabled: false,
          customHeaders: {},
          temperature: undefined,
          createdAt: new Date().toISOString(),
        },
      ],
    })

    const story = makeStory()
    story.settings.providerId = 'old'
    await createStory(dataDir, story)

    await expect(getModel(dataDir, story.id, { role: 'generation' })).rejects.toThrow(/No LLM provider/)
  })
})
