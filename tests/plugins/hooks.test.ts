import { describe, it, expect } from 'vitest'
import { makeTestSettings } from '../setup'
import {
  runBeforeContext,
  runBeforeGeneration,
  runAfterGeneration,
  runAfterSave,
} from '@/server/plugins/hooks'
import type { WritingPlugin, GenerationResult } from '@/server/plugins/types'
import type { ContextBuildState, ContextMessage } from '@/server/llm/context-builder'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

function makeState(overrides: Partial<ContextBuildState> = {}): ContextBuildState {
  const now = new Date().toISOString()
  return {
    story: {
      id: 'story-1',
      name: 'Test',
      description: 'Test story',
      summary: '',
      createdAt: now,
      updatedAt: now,
      settings: makeTestSettings(),
    } as StoryMeta,
    proseFragments: [],
    chapterSummaries: [],
    stickyGuidelines: [],
    stickyKnowledge: [],
    stickyCharacters: [],
    guidelineShortlist: [],
    knowledgeShortlist: [],
    characterShortlist: [],
    authorInput: 'test input',
    ...overrides,
  }
}

function makeMessages(): ContextMessage[] {
  return [
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'User input' },
  ]
}

function makeGenResult(): GenerationResult {
  return {
    text: 'Generated text',
    fragmentId: 'pr-0001',
    toolCalls: [],
  }
}

function makePlugin(hooks: WritingPlugin['hooks']): WritingPlugin {
  return {
    manifest: { name: 'hook-test', version: '1.0.0', description: 'test' },
    hooks,
  }
}

describe('runBeforeContext', () => {
  it('passes through when no plugins have hooks', async () => {
    const state = makeState()
    const result = await runBeforeContext([], state)
    expect(result).toBe(state)
  })

  it('applies a single plugin hook', async () => {
    const state = makeState()
    const plugin = makePlugin({
      beforeContext: (ctx) => ({ ...ctx, authorInput: 'modified' }),
    })

    const result = await runBeforeContext([plugin], state)
    expect(result.authorInput).toBe('modified')
  })

  it('chains multiple plugins sequentially', async () => {
    const state = makeState({ authorInput: 'start' })

    const plugin1 = makePlugin({
      beforeContext: (ctx) => ({ ...ctx, authorInput: ctx.authorInput + '-p1' }),
    })
    const plugin2 = makePlugin({
      beforeContext: (ctx) => ({ ...ctx, authorInput: ctx.authorInput + '-p2' }),
    })

    const result = await runBeforeContext([plugin1, plugin2], state)
    expect(result.authorInput).toBe('start-p1-p2')
  })

  it('skips plugins without beforeContext hook', async () => {
    const state = makeState({ authorInput: 'original' })
    const noHook = makePlugin({})
    const withHook = makePlugin({
      beforeContext: (ctx) => ({ ...ctx, authorInput: 'changed' }),
    })

    const result = await runBeforeContext([noHook, withHook], state)
    expect(result.authorInput).toBe('changed')
  })
})

describe('runBeforeGeneration', () => {
  it('passes through with no plugins', async () => {
    const msgs = makeMessages()
    const result = await runBeforeGeneration([], msgs)
    expect(result).toBe(msgs)
  })

  it('modifies messages', async () => {
    const msgs = makeMessages()
    const plugin = makePlugin({
      beforeGeneration: (messages) => [
        ...messages,
        { role: 'system' as const, content: 'Extra instruction' },
      ],
    })

    const result = await runBeforeGeneration([plugin], msgs)
    expect(result).toHaveLength(3)
    expect(result[2].content).toBe('Extra instruction')
  })
})

describe('runAfterGeneration', () => {
  it('passes through with no plugins', async () => {
    const genResult = makeGenResult()
    const result = await runAfterGeneration([], genResult)
    expect(result).toBe(genResult)
  })

  it('transforms generation result', async () => {
    const genResult = makeGenResult()
    const plugin = makePlugin({
      afterGeneration: (r) => ({ ...r, text: r.text.toUpperCase() }),
    })

    const result = await runAfterGeneration([plugin], genResult)
    expect(result.text).toBe('GENERATED TEXT')
  })
})

describe('runAfterSave', () => {
  it('runs without error on empty plugins', async () => {
    const fragment = {
      id: 'pr-0001',
      type: 'prose',
      name: 'Test',
      description: 'test',
      content: 'hello',
      tags: [],
      refs: [],
      sticky: false,
      placement: 'user' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: 0,
      meta: {},
    } as Fragment

    await expect(runAfterSave([], fragment, 'story-1')).resolves.toBeUndefined()
  })

  it('calls afterSave hooks', async () => {
    const calls: string[] = []
    const plugin = makePlugin({
      afterSave: (fragment, storyId) => {
        calls.push(`${fragment.id}:${storyId}`)
      },
    })

    const fragment = {
      id: 'pr-0001',
      type: 'prose',
      name: 'Test',
      description: 'test',
      content: 'hello',
      tags: [],
      refs: [],
      sticky: false,
      placement: 'user' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: 0,
      meta: {},
    } as Fragment

    await runAfterSave([plugin], fragment, 'story-1')
    expect(calls).toEqual(['pr-0001:story-1'])
  })
})
