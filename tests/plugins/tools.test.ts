import { describe, it, expect } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod/v4'
import { collectPluginTools } from '@/server/plugins/tools'
import type { WritingPlugin } from '@/server/plugins/types'

function makePlugin(name: string, toolDefs?: WritingPlugin['tools']): WritingPlugin {
  return {
    manifest: { name, version: '1.0.0', description: `Plugin ${name}` },
    tools: toolDefs,
  }
}

describe('collectPluginTools', () => {
  it('returns empty object for no plugins', () => {
    const tools = collectPluginTools([], '/data', 'story-1')
    expect(tools).toEqual({})
  })

  it('returns empty object for plugins without tools', () => {
    const plugin = makePlugin('no-tools')
    const tools = collectPluginTools([plugin], '/data', 'story-1')
    expect(tools).toEqual({})
  })

  it('collects tools from a single plugin', () => {
    const plugin = makePlugin('with-tools', (_dataDir, _storyId) => ({
      myTool: tool({
        description: 'A test tool',
        inputSchema: z.object({ input: z.string() }),
        execute: async ({ input }) => ({ result: input }),
      }),
    }))

    const tools = collectPluginTools([plugin], '/data', 'story-1')
    expect(tools).toHaveProperty('myTool')
  })

  it('merges tools from multiple plugins', () => {
    const plugin1 = makePlugin('plugin1', () => ({
      tool1: tool({
        description: 'Tool 1',
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      }),
    }))
    const plugin2 = makePlugin('plugin2', () => ({
      tool2: tool({
        description: 'Tool 2',
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      }),
    }))

    const tools = collectPluginTools([plugin1, plugin2], '/data', 'story-1')
    expect(tools).toHaveProperty('tool1')
    expect(tools).toHaveProperty('tool2')
  })

  it('passes dataDir and storyId to tool factory', () => {
    let receivedDataDir: string | undefined
    let receivedStoryId: string | undefined

    const plugin = makePlugin('context-check', (dataDir, storyId) => {
      receivedDataDir = dataDir
      receivedStoryId = storyId
      return {}
    })

    collectPluginTools([plugin], '/my/data', 'story-42')
    expect(receivedDataDir).toBe('/my/data')
    expect(receivedStoryId).toBe('story-42')
  })
})
