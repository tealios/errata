import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod/v4'
import { createTempDir } from '../setup'
import {
  createStory,
  createFragment,
  listFragments,
} from '@/server/fragments/storage'
import { pluginRegistry } from '@/server/plugins/registry'
import type { WritingPlugin } from '@/server/plugins/types'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

// Mock the AI SDK streamText
vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    streamText: vi.fn(),
  }
})

import { streamText } from 'ai'
import { createApp } from '@/server/api'

const mockedStreamText = vi.mocked(streamText)

function makeStory(enabledPlugins: string[] = []): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: { outputFormat: 'markdown', enabledPlugins, summarizationThreshold: 4, maxSteps: 10, providerId: null, modelId: null, contextOrderMode: 'simple' as const, fragmentOrder: [] },
  }
}

function createMockStreamResult(text: string) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })

  // Create a proper ReadableStream for textStream that supports tee()
  const textStream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue(text)
      controller.close()
    },
  })

  return {
    textStream,
    text: Promise.resolve(text),
    usage: Promise.resolve({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }),
    finishReason: Promise.resolve('stop' as const),
    steps: Promise.resolve([]),
    toTextStreamResponse: () => new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
    toUIMessageStreamResponse: () => new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
  }
}

describe('plugin integration', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>
  const storyId = 'story-test'

  async function api(path: string, init?: RequestInit) {
    const res = await app.fetch(
      new Request(`http://localhost/api${path}`, init),
    )
    return res
  }

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    pluginRegistry.clear()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    pluginRegistry.clear()
    await cleanup()
  })

  it('GET /plugins returns registered plugins', async () => {
    const testPlugin: WritingPlugin = {
      manifest: { name: 'test-plugin', version: '1.0.0', description: 'Test' },
    }
    pluginRegistry.register(testPlugin)
    app = createApp(dataDir)

    const res = await api('/plugins')
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('test-plugin')
  })

  it('PATCH /stories/:storyId/settings updates enabledPlugins', async () => {
    await createStory(dataDir, makeStory())
    app = createApp(dataDir)

    const res = await api(`/stories/${storyId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledPlugins: ['names'] }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as StoryMeta
    expect(body.settings.enabledPlugins).toEqual(['names'])
  })

  it('PATCH /stories/:storyId/settings updates outputFormat', async () => {
    await createStory(dataDir, makeStory())
    app = createApp(dataDir)

    const res = await api(`/stories/${storyId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputFormat: 'plaintext' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as StoryMeta
    expect(body.settings.outputFormat).toBe('plaintext')
  })

  it('PATCH /stories/:storyId/settings returns 404 for unknown story', async () => {
    app = createApp(dataDir)

    const res = await api('/stories/nonexistent/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledPlugins: [] }),
    })

    expect(res.status).toBe(404)
  })

  it('generation pipeline runs enabled plugin hooks', async () => {
    const hookCalls: string[] = []

    const testPlugin: WritingPlugin = {
      manifest: { name: 'hook-test', version: '1.0.0', description: 'Hook test' },
      hooks: {
        beforeContext: (ctx) => {
          hookCalls.push('beforeContext')
          return { ...ctx, authorInput: ctx.authorInput + ' [modified]' }
        },
        beforeGeneration: (msgs) => {
          hookCalls.push('beforeGeneration')
          return msgs
        },
        afterGeneration: (result) => {
          hookCalls.push('afterGeneration')
          return { ...result, text: result.text + ' [postprocessed]' }
        },
        afterSave: () => {
          hookCalls.push('afterSave')
        },
      },
    }

    pluginRegistry.register(testPlugin)
    await createStory(dataDir, makeStory(['hook-test']))
    app = createApp(dataDir)

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Generated text.') as any,
    )

    const res = await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Write something', saveResult: true }),
    })

    expect(res.status).toBe(200)
    const text = await res.text()

    // With streaming, client receives the raw generated text immediately
    // (hooks run in background after streaming completes)
    expect(text).toBe('Generated text.')

    // Wait for async save and hooks to complete (background operation)
    await new Promise((r) => setTimeout(r, 200))

    // All hooks should have run in order
    expect(hookCalls).toEqual([
      'beforeContext',
      'beforeGeneration',
      'afterGeneration',
      'afterSave',
    ])

    // Saved fragment should have the postprocessed text (after hooks ran)
    const fragments = await listFragments(dataDir, storyId, 'prose')
    expect(fragments.length).toBe(1)
    expect(fragments[0].content).toBe('Generated text. [postprocessed]')
  })

  it('disabled plugins are not invoked', async () => {
    const hookCalls: string[] = []

    const enabledPlugin: WritingPlugin = {
      manifest: { name: 'enabled', version: '1.0.0', description: 'Enabled' },
      hooks: {
        beforeContext: (ctx) => {
          hookCalls.push('enabled:beforeContext')
          return ctx
        },
      },
    }
    const disabledPlugin: WritingPlugin = {
      manifest: { name: 'disabled', version: '1.0.0', description: 'Disabled' },
      hooks: {
        beforeContext: (ctx) => {
          hookCalls.push('disabled:beforeContext')
          return ctx
        },
      },
    }

    pluginRegistry.register(enabledPlugin)
    pluginRegistry.register(disabledPlugin)
    // Only 'enabled' is in the story's enabledPlugins
    await createStory(dataDir, makeStory(['enabled']))
    app = createApp(dataDir)

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Text.') as any,
    )

    await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Go', saveResult: false }),
    })

    expect(hookCalls).toEqual(['enabled:beforeContext'])
  })

  it('plugin tools are merged into streamText call', async () => {
    const testPlugin: WritingPlugin = {
      manifest: { name: 'tool-test', version: '1.0.0', description: 'Tool test' },
      tools: (_dataDir, _storyId) => ({
        customTool: tool({
          description: 'A custom plugin tool',
          inputSchema: z.object({ query: z.string() }),
          execute: async ({ query }) => ({ answer: query }),
        }),
      }),
    }

    pluginRegistry.register(testPlugin)
    await createStory(dataDir, makeStory(['tool-test']))
    app = createApp(dataDir)

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Result.') as any,
    )

    await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Test', saveResult: false }),
    })

    const callArgs = mockedStreamText.mock.calls[0][0]
    expect(callArgs.tools).toHaveProperty('customTool')
    // Built-in tools should still be present (listFragmentTypes is always included)
    expect(callArgs.tools).toHaveProperty('listFragmentTypes')
  })

  it('no plugin tools when no plugins are enabled', async () => {
    await createStory(dataDir, makeStory([]))
    app = createApp(dataDir)

    mockedStreamText.mockReturnValue(
      createMockStreamResult('Result.') as any,
    )

    await api(`/stories/${storyId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Test', saveResult: false }),
    })

    const callArgs = mockedStreamText.mock.calls[0][0]
    // Should have built-in tools but no plugin tools
    expect(callArgs.tools).toHaveProperty('listFragmentTypes')
    expect(callArgs.tools).not.toHaveProperty('customTool')
  })
})
