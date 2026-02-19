import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import {
  createStory,
  createFragment,
} from '@/server/fragments/storage'
import { addProseSection } from '@/server/fragments/prose-chain'
import { addProseVariation } from '@/server/fragments/prose-chain'
import { saveAnalysis } from '@/server/librarian/storage'
import { unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'
import {
  buildContext,
  buildContextState,
  assembleMessages,
  createDefaultBlocks,
  compileBlocks,
  addCacheBreakpoints,
  findBlock,
  replaceBlockContent,
  removeBlock,
  insertBlockBefore,
  insertBlockAfter,
  reorderBlock,
  type ContextBlock,
  type ContextMessage,
} from '@/server/llm/context-builder'

function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    summary: 'The hero embarked on a journey.',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
    ...overrides,
  }
}

function makeFragment(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'pr-0001',
    type: 'prose',
    name: 'Opening',
    description: 'The opening scene',
    content: 'Once upon a time...',
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

describe('context-builder', () => {
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

  it('builds context with user message containing story info', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const messages = await buildContext(dataDir, story.id, 'Continue the story')
    const msg = messages.find((m) => m.role === 'user')

    expect(msg).toBeDefined()
    expect(msg!.content).toContain('Test Story')
    expect(msg!.content).toContain('A test story')
    expect(msg!.content).toContain('The hero embarked on a journey.')
  })

  it('includes recent prose fragments in context', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const prose1 = makeFragment({
      id: 'pr-0001',
      type: 'prose',
      name: 'Chapter 1',
      content: 'The adventure begins here.',
      order: 1,
    })
    const prose2 = makeFragment({
      id: 'pr-0002',
      type: 'prose',
      name: 'Chapter 2',
      content: 'The hero meets a friend.',
      order: 2,
    })
    await createFragment(dataDir, story.id, prose1)
    await createFragment(dataDir, story.id, prose2)

    const messages = await buildContext(dataDir, story.id, 'What happens next?')
    const msg = messages.find((m) => m.role === 'user')

    expect(msg!.content).toContain('The adventure begins here.')
    expect(msg!.content).toContain('The hero meets a friend.')
  })

  it('includes sticky guidelines in full', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const guideline = makeFragment({
      id: 'gl-0001',
      type: 'guideline',
      name: 'Tone',
      description: 'Writing tone rules',
      content: 'Write in a dark, gothic style.',
      sticky: true,
    })
    await createFragment(dataDir, story.id, guideline)

    const messages = await buildContext(dataDir, story.id, 'Continue')
    const msg = messages.find((m) => m.role === 'user')

    expect(msg!.content).toContain('Write in a dark, gothic style.')
  })

  it('includes sticky knowledge in full', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const knowledge = makeFragment({
      id: 'kn-0001',
      type: 'knowledge',
      name: 'Magic System',
      description: 'How magic works',
      content: 'Magic requires blood sacrifice.',
      sticky: true,
    })
    await createFragment(dataDir, story.id, knowledge)

    const messages = await buildContext(dataDir, story.id, 'Continue')
    const msg = messages.find((m) => m.role === 'user')

    expect(msg!.content).toContain('Magic requires blood sacrifice.')
  })

  it('includes non-sticky guidelines as shortlist only', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const guideline = makeFragment({
      id: 'gl-0002',
      type: 'guideline',
      name: 'POV Rules',
      description: 'Point of view constraints',
      content: 'Always use third person limited.',
      sticky: false,
    })
    await createFragment(dataDir, story.id, guideline)

    const messages = await buildContext(dataDir, story.id, 'Continue')
    const msg = messages.find((m) => m.role === 'user')

    // Shortlist should contain id and description but not full content
    expect(msg!.content).toContain('gl-0002')
    expect(msg!.content).toContain('Point of view constraints')
    expect(msg!.content).not.toContain('Always use third person limited.')
  })

  it('includes the author input as the user message', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const messages = await buildContext(dataDir, story.id, 'Make the dragon attack!')
    const user = messages.find((m) => m.role === 'user')

    expect(user).toBeDefined()
    expect(user!.content).toContain('Make the dragon attack!')
  })

  it('orders prose by order field then createdAt', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const prose1 = makeFragment({
      id: 'pr-0001',
      type: 'prose',
      name: 'Second',
      content: 'Second fragment.',
      order: 2,
      createdAt: '2025-01-01T00:00:00.000Z',
    })
    const prose2 = makeFragment({
      id: 'pr-0002',
      type: 'prose',
      name: 'First',
      content: 'First fragment.',
      order: 1,
      createdAt: '2025-01-02T00:00:00.000Z',
    })
    await createFragment(dataDir, story.id, prose1)
    await createFragment(dataDir, story.id, prose2)

    const messages = await buildContext(dataDir, story.id, 'Continue')
    const content = messages.find((m) => m.role === 'user')!.content as string

    const firstIdx = content.indexOf('First fragment.')
    const secondIdx = content.indexOf('Second fragment.')
    expect(firstIdx).toBeLessThan(secondIdx)
  })

  it('limits prose fragments to last N (default 10)', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    // Create 15 prose fragments
    for (let i = 0; i < 15; i++) {
      await createFragment(dataDir, story.id, makeFragment({
        id: `pr-${String(i).padStart(4, '0')}`,
        type: 'prose',
        name: `Prose ${i}`,
        content: `Content of prose ${i}`,
        order: i,
      }))
    }

    const messages = await buildContext(dataDir, story.id, 'Continue')
    const content = messages.find((m) => m.role === 'user')!.content as string

    // Should include the last 10 (5-14) but not the first 5 (0-4)
    expect(content).not.toContain('Content of prose 0')
    expect(content).not.toContain('Content of prose 4')
    expect(content).toContain('Content of prose 5')
    expect(content).toContain('Content of prose 14')
  })

  it('returns ContextBuildState with correct structure', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const guideline = makeFragment({
      id: 'gl-0001',
      type: 'guideline',
      name: 'Tone',
      description: 'Writing tone',
      content: 'Dark tone.',
      sticky: true,
    })
    const knowledge = makeFragment({
      id: 'kn-0001',
      type: 'knowledge',
      name: 'Lore',
      description: 'World lore',
      content: 'Ancient dragons.',
      sticky: true,
    })
    await createFragment(dataDir, story.id, guideline)
    await createFragment(dataDir, story.id, knowledge)

    const messages = await buildContext(dataDir, story.id, 'Continue')

    // Should have a system message and a user message
    expect(messages.length).toBe(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
  })

  it('includes sticky characters in full', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const character = makeFragment({
      id: 'ch-0001',
      type: 'character',
      name: 'Elena',
      description: 'The protagonist',
      content: 'Elena is a fierce warrior with red hair.',
      sticky: true,
    })
    await createFragment(dataDir, story.id, character)

    const messages = await buildContext(dataDir, story.id, 'Continue')
    const msg = messages.find((m) => m.role === 'user')

    expect(msg!.content).toContain('Elena is a fierce warrior with red hair.')
    expect(msg!.content).toContain('## Characters')
  })

  it('includes non-sticky characters as shortlist only', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const character = makeFragment({
      id: 'ch-0002',
      type: 'character',
      name: 'Villain',
      description: 'The antagonist',
      content: 'The dark lord rules with an iron fist.',
      sticky: false,
    })
    await createFragment(dataDir, story.id, character)

    const messages = await buildContext(dataDir, story.id, 'Continue')
    const msg = messages.find((m) => m.role === 'user')

    // Shortlist should contain id and description but not full content
    expect(msg!.content).toContain('ch-0002')
    expect(msg!.content).toContain('The antagonist')
    expect(msg!.content).not.toContain('The dark lord rules with an iron fist.')
  })

  it('includes fragment tool availability in system message', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const messages = await buildContext(dataDir, story.id, 'Continue')
    const sysMsg = messages.find((m) => m.role === 'system')!

    // System message should list available tools (built-in types have llmTools: false)
    expect(sysMsg.content).not.toContain('getCharacter')
    expect(sysMsg.content).not.toContain('listCharacters')
    expect(sysMsg.content).toContain('listFragmentTypes')
    expect(sysMsg.content).toContain('creative writing assistant')
  })

  it('includes only prose before target fragment when proseBeforeFragmentId is set', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    const proseIds = ['pr-0001', 'pr-0002', 'pr-0003', 'pr-0004', 'pr-0005']
    const proseContents = ['A passage', 'B passage', 'C passage', 'D passage', 'E passage']

    for (let i = 0; i < proseIds.length; i++) {
      const fragment = makeFragment({
        id: proseIds[i],
        type: 'prose',
        name: `Prose ${i + 1}`,
        content: proseContents[i],
        order: i + 1,
      })
      await createFragment(dataDir, story.id, fragment)
      await addProseSection(dataDir, story.id, fragment.id)
    }

    const state = await buildContextState(dataDir, story.id, 'Regenerate C', {
      excludeFragmentId: 'pr-0003',
      proseBeforeFragmentId: 'pr-0003',
    })

    const included = state.proseFragments.map(f => f.id)
    expect(included).toEqual(['pr-0001', 'pr-0002'])
  })

  it('omits story summary when excludeStorySummary is true', async () => {
    const story = makeStory({ summary: 'Late events that should not leak into regenerate context.' })
    await createStory(dataDir, story)

    const messages = await buildContext(dataDir, story.id, 'Regenerate this section', {
      excludeStorySummary: true,
    })
    const user = messages.find((m) => m.role === 'user')!

    expect(user.content).not.toContain('## Story Summary So Far')
    expect(user.content).not.toContain('Late events that should not leak into regenerate context.')
  })

  it('includes only summary updates before target fragment when summaryBeforeFragmentId is set', async () => {
    const story = makeStory({ summary: 'Global summary with future info that should be excluded.' })
    await createStory(dataDir, story)

    const proseIds = ['pr-0001', 'pr-0002', 'pr-0003', 'pr-0004', 'pr-0005']
    for (let i = 0; i < proseIds.length; i++) {
      const fragment = makeFragment({
        id: proseIds[i],
        type: 'prose',
        name: `Prose ${i + 1}`,
        content: `Passage ${i + 1}`,
        order: i + 1,
      })
      await createFragment(dataDir, story.id, fragment)
      await addProseSection(dataDir, story.id, fragment.id)
    }

    await saveAnalysis(dataDir, story.id, {
      id: 'la-a',
      createdAt: '2025-01-01T00:00:00.000Z',
      fragmentId: 'pr-0001',
      summaryUpdate: 'Summary A',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })
    await saveAnalysis(dataDir, story.id, {
      id: 'la-b',
      createdAt: '2025-01-02T00:00:00.000Z',
      fragmentId: 'pr-0002',
      summaryUpdate: 'Summary B',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })
    await saveAnalysis(dataDir, story.id, {
      id: 'la-d',
      createdAt: '2025-01-03T00:00:00.000Z',
      fragmentId: 'pr-0004',
      summaryUpdate: 'Summary D',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    const messages = await buildContext(dataDir, story.id, 'Regenerate C', {
      proseBeforeFragmentId: 'pr-0003',
      summaryBeforeFragmentId: 'pr-0003',
      excludeFragmentId: 'pr-0003',
    })
    const user = messages.find((m) => m.role === 'user')!

    expect(user.content).toContain('Summary A Summary B')
    expect(user.content).not.toContain('Summary D')
    expect(user.content).not.toContain('Global summary with future info that should be excluded.')
  })

  it('omits summary when there are no summary updates before target time', async () => {
    const story = makeStory({ summary: 'Future-only summary should not be used.' })
    await createStory(dataDir, story)

    const proseA = makeFragment({ id: 'pr-0001', type: 'prose', name: 'A', content: 'A', order: 1 })
    const proseB = makeFragment({ id: 'pr-0002', type: 'prose', name: 'B', content: 'B', order: 2 })
    const proseC = makeFragment({ id: 'pr-0003', type: 'prose', name: 'C', content: 'C', order: 3 })
    await createFragment(dataDir, story.id, proseA)
    await createFragment(dataDir, story.id, proseB)
    await createFragment(dataDir, story.id, proseC)
    await addProseSection(dataDir, story.id, proseA.id)
    await addProseSection(dataDir, story.id, proseB.id)
    await addProseSection(dataDir, story.id, proseC.id)

    await saveAnalysis(dataDir, story.id, {
      id: 'la-c',
      createdAt: '2025-01-03T00:00:00.000Z',
      fragmentId: 'pr-0003',
      summaryUpdate: 'Only after A.',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    const messages = await buildContext(dataDir, story.id, 'Regenerate A', {
      proseBeforeFragmentId: 'pr-0001',
      summaryBeforeFragmentId: 'pr-0001',
      excludeFragmentId: 'pr-0001',
    })
    const user = messages.find((m) => m.role === 'user')!

    expect(user.content).not.toContain('## Story Summary So Far')
    expect(user.content).not.toContain('Only after A.')
    expect(user.content).not.toContain('Future-only summary should not be used.')
  })

  it('uses section position for inactive variation when building summary before target', async () => {
    const story = makeStory({ summary: 'Global summary should not leak in.' })
    await createStory(dataDir, story)

    const proseA = makeFragment({ id: 'pr-0001', type: 'prose', name: 'A', content: 'A', order: 1 })
    const proseB = makeFragment({ id: 'pr-0002', type: 'prose', name: 'B', content: 'B', order: 2 })
    const proseC = makeFragment({ id: 'pr-0003', type: 'prose', name: 'C', content: 'C', order: 3 })
    const proseC2 = makeFragment({ id: 'pr-0006', type: 'prose', name: 'C2', content: 'C2', order: 4 })
    await createFragment(dataDir, story.id, proseA)
    await createFragment(dataDir, story.id, proseB)
    await createFragment(dataDir, story.id, proseC)
    await createFragment(dataDir, story.id, proseC2)
    await addProseSection(dataDir, story.id, proseA.id)
    await addProseSection(dataDir, story.id, proseB.id)
    await addProseSection(dataDir, story.id, proseC.id)
    await addProseVariation(dataDir, story.id, 2, proseC2.id)

    await saveAnalysis(dataDir, story.id, {
      id: 'la-a',
      createdAt: '2025-01-01T00:00:00.000Z',
      fragmentId: 'pr-0001',
      summaryUpdate: 'Summary A',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })
    await saveAnalysis(dataDir, story.id, {
      id: 'la-b',
      createdAt: '2025-01-02T00:00:00.000Z',
      fragmentId: 'pr-0002',
      summaryUpdate: 'Summary B',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })
    await saveAnalysis(dataDir, story.id, {
      id: 'la-c2',
      createdAt: '2025-01-03T00:00:00.000Z',
      fragmentId: 'pr-0006',
      summaryUpdate: 'Summary C2',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    const messages = await buildContext(dataDir, story.id, 'Regenerate inactive C', {
      proseBeforeFragmentId: 'pr-0003',
      summaryBeforeFragmentId: 'pr-0003',
      excludeFragmentId: 'pr-0003',
    })
    const user = messages.find((m) => m.role === 'user')!

    expect(user.content).toContain('Summary A Summary B')
    expect(user.content).not.toContain('Summary C2')
  })

  it('uses latest analysis per fragment when rebuilding summaryBeforeFragmentId', async () => {
    const story = makeStory({ summary: 'Global summary should not leak in.' })
    await createStory(dataDir, story)

    const proseA = makeFragment({ id: 'pr-0001', type: 'prose', name: 'A', content: 'A', order: 1 })
    const proseB = makeFragment({ id: 'pr-0002', type: 'prose', name: 'B', content: 'B', order: 2 })
    const proseC = makeFragment({ id: 'pr-0003', type: 'prose', name: 'C', content: 'C', order: 3 })
    await createFragment(dataDir, story.id, proseA)
    await createFragment(dataDir, story.id, proseB)
    await createFragment(dataDir, story.id, proseC)
    await addProseSection(dataDir, story.id, proseA.id)
    await addProseSection(dataDir, story.id, proseB.id)
    await addProseSection(dataDir, story.id, proseC.id)

    await saveAnalysis(dataDir, story.id, {
      id: 'la-a',
      createdAt: '2025-01-01T00:00:00.000Z',
      fragmentId: 'pr-0001',
      summaryUpdate: 'Summary A',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })
    await saveAnalysis(dataDir, story.id, {
      id: 'la-b-old',
      createdAt: '2025-01-01T00:00:00.000Z',
      fragmentId: 'pr-0002',
      summaryUpdate: 'Summary B old',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })
    await saveAnalysis(dataDir, story.id, {
      id: 'la-b-new',
      createdAt: '2025-01-02T00:00:00.000Z',
      fragmentId: 'pr-0002',
      summaryUpdate: 'Summary B new',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    const messages = await buildContext(dataDir, story.id, 'Regenerate C', {
      proseBeforeFragmentId: 'pr-0003',
      summaryBeforeFragmentId: 'pr-0003',
      excludeFragmentId: 'pr-0003',
    })
    const user = messages.find((m) => m.role === 'user')!

    expect(user.content).toContain('Summary A Summary B new')
    expect(user.content).not.toContain('Summary B old')
  })

  it('rebuilds summaryBeforeFragmentId correctly when analysis index is missing', async () => {
    const story = makeStory({ summary: 'Global summary should not leak in.' })
    await createStory(dataDir, story)

    const proseA = makeFragment({ id: 'pr-0001', type: 'prose', name: 'A', content: 'A', order: 1 })
    const proseB = makeFragment({ id: 'pr-0002', type: 'prose', name: 'B', content: 'B', order: 2 })
    const proseC = makeFragment({ id: 'pr-0003', type: 'prose', name: 'C', content: 'C', order: 3 })
    await createFragment(dataDir, story.id, proseA)
    await createFragment(dataDir, story.id, proseB)
    await createFragment(dataDir, story.id, proseC)
    await addProseSection(dataDir, story.id, proseA.id)
    await addProseSection(dataDir, story.id, proseB.id)
    await addProseSection(dataDir, story.id, proseC.id)

    await saveAnalysis(dataDir, story.id, {
      id: 'la-a',
      createdAt: '2025-01-01T00:00:00.000Z',
      fragmentId: 'pr-0001',
      summaryUpdate: 'Summary A',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })
    await saveAnalysis(dataDir, story.id, {
      id: 'la-b',
      createdAt: '2025-01-02T00:00:00.000Z',
      fragmentId: 'pr-0002',
      summaryUpdate: 'Summary B',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })

    const indexPath = join(dataDir, 'stories', story.id, 'branches', 'main', 'librarian', 'index.json')
    if (existsSync(indexPath)) {
      await unlink(indexPath)
    }

    const messages = await buildContext(dataDir, story.id, 'Regenerate C', {
      proseBeforeFragmentId: 'pr-0003',
      summaryBeforeFragmentId: 'pr-0003',
      excludeFragmentId: 'pr-0003',
    })
    const user = messages.find((m) => m.role === 'user')!

    expect(user.content).toContain('Summary A Summary B')
    expect(user.content).not.toContain('Global summary should not leak in.')
  })

  it('limits prose by maxCharacters', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    // Create 3 prose fragments with known content lengths
    // 'A'.repeat(100) = 100 chars, 'B'.repeat(100) = 100 chars, 'C'.repeat(100) = 100 chars
    for (let i = 0; i < 3; i++) {
      const letter = String.fromCharCode(65 + i) // A, B, C
      await createFragment(dataDir, story.id, makeFragment({
        id: `pr-000${i + 1}`,
        type: 'prose',
        name: `Prose ${letter}`,
        content: letter.repeat(100),
        order: i + 1,
      }))
    }

    // Budget of 150 chars should only fit 1 fragment (the last one = C)
    const state = await buildContextState(dataDir, story.id, 'Continue', {
      contextCompact: { type: 'maxCharacters', value: 150 },
    })

    expect(state.proseFragments.length).toBe(1)
    expect(state.proseFragments[0].id).toBe('pr-0003')
  })

  it('limits prose by maxTokens (chars / 4)', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    // 3 fragments, each 400 chars = 100 tokens each
    for (let i = 0; i < 3; i++) {
      const letter = String.fromCharCode(65 + i)
      await createFragment(dataDir, story.id, makeFragment({
        id: `pr-000${i + 1}`,
        type: 'prose',
        name: `Prose ${letter}`,
        content: letter.repeat(400),
        order: i + 1,
      }))
    }

    // Budget of 250 tokens should fit 2 fragments (B and C, 100+100=200, next would be 300 > 250)
    const state = await buildContextState(dataDir, story.id, 'Continue', {
      contextCompact: { type: 'maxTokens', value: 250 },
    })

    expect(state.proseFragments.length).toBe(2)
    expect(state.proseFragments[0].id).toBe('pr-0002')
    expect(state.proseFragments[1].id).toBe('pr-0003')
  })

  it('maxCharacters always includes at least one fragment even if over budget', async () => {
    const story = makeStory()
    await createStory(dataDir, story)

    await createFragment(dataDir, story.id, makeFragment({
      id: 'pr-0001',
      type: 'prose',
      name: 'Big',
      content: 'X'.repeat(10000),
      order: 1,
    }))

    // Budget is tiny but should still include the last fragment
    const state = await buildContextState(dataDir, story.id, 'Continue', {
      contextCompact: { type: 'maxCharacters', value: 1 },
    })

    expect(state.proseFragments.length).toBe(1)
    expect(state.proseFragments[0].id).toBe('pr-0001')
  })

  it('reads contextCompact from story settings when not passed via opts', async () => {
    const story = makeStory({
      settings: makeTestSettings({ contextCompact: { type: 'maxCharacters', value: 150 } }),
    })
    await createStory(dataDir, story)

    for (let i = 0; i < 3; i++) {
      const letter = String.fromCharCode(65 + i)
      await createFragment(dataDir, story.id, makeFragment({
        id: `pr-000${i + 1}`,
        type: 'prose',
        name: `Prose ${letter}`,
        content: letter.repeat(100),
        order: i + 1,
      }))
    }

    // Story setting says maxCharacters:150, should only fit 1 fragment
    const state = await buildContextState(dataDir, story.id, 'Continue')

    expect(state.proseFragments.length).toBe(1)
    expect(state.proseFragments[0].id).toBe('pr-0003')
  })
})

describe('context blocks', () => {
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

  describe('createDefaultBlocks', () => {
    it('returns expected block IDs for a basic state', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      const state = await buildContextState(dataDir, story.id, 'Continue the story')
      const blocks = createDefaultBlocks(state)

      const ids = blocks.map(b => b.id)
      expect(ids).toContain('instructions')
      expect(ids).toContain('tools')
      expect(ids).toContain('story-info')
      expect(ids).toContain('summary')
      expect(ids).toContain('author-input')
    })

    it('assigns correct roles to blocks', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      const state = await buildContextState(dataDir, story.id, 'Continue')
      const blocks = createDefaultBlocks(state)

      const systemIds = blocks.filter(b => b.role === 'system').map(b => b.id)
      const userIds = blocks.filter(b => b.role === 'user').map(b => b.id)

      expect(systemIds).toContain('instructions')
      expect(systemIds).toContain('tools')
      expect(userIds).toContain('story-info')
      expect(userIds).toContain('author-input')
    })

    it('omits summary block when summary is empty', async () => {
      const story = makeStory({ summary: '' })
      await createStory(dataDir, story)

      const state = await buildContextState(dataDir, story.id, 'Continue')
      const blocks = createDefaultBlocks(state)

      expect(findBlock(blocks, 'summary')).toBeUndefined()
    })

    it('omits prose block when no prose fragments', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      const state = await buildContextState(dataDir, story.id, 'Continue')
      const blocks = createDefaultBlocks(state)

      expect(findBlock(blocks, 'prose')).toBeUndefined()
    })

    it('creates prose block when prose fragments exist', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment({
        id: 'pr-0001', type: 'prose', name: 'Ch1', content: 'Hello world.', order: 1,
      }))

      const state = await buildContextState(dataDir, story.id, 'Continue')
      const blocks = createDefaultBlocks(state)

      const prose = findBlock(blocks, 'prose')
      expect(prose).toBeDefined()
      expect(prose!.role).toBe('user')
      expect(prose!.content).toContain('Hello world.')
    })

    it('creates shortlist blocks for non-sticky fragments', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeFragment({
        id: 'gl-0001', type: 'guideline', name: 'Tone', description: 'Tone rules',
        content: 'Write darkly.', sticky: false,
      }))
      await createFragment(dataDir, story.id, makeFragment({
        id: 'kn-0001', type: 'knowledge', name: 'Lore', description: 'World lore',
        content: 'Magic exists.', sticky: false,
      }))

      const state = await buildContextState(dataDir, story.id, 'Continue')
      const blocks = createDefaultBlocks(state)

      expect(findBlock(blocks, 'shortlist-guidelines')).toBeDefined()
      expect(findBlock(blocks, 'shortlist-knowledge')).toBeDefined()
    })

    it('omits shortlist blocks when no non-sticky fragments of that type', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      const state = await buildContextState(dataDir, story.id, 'Continue')
      const blocks = createDefaultBlocks(state)

      expect(findBlock(blocks, 'shortlist-guidelines')).toBeUndefined()
      expect(findBlock(blocks, 'shortlist-knowledge')).toBeUndefined()
      expect(findBlock(blocks, 'shortlist-characters')).toBeUndefined()
    })

    it('all blocks have source "builtin"', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      const state = await buildContextState(dataDir, story.id, 'Continue')
      const blocks = createDefaultBlocks(state)

      for (const block of blocks) {
        expect(block.source).toBe('builtin')
      }
    })

    it('includes hierarchical chapter summaries when enabled', async () => {
      const story = makeStory({
        settings: makeTestSettings({
          enableHierarchicalSummary: true,
          contextCompact: { type: 'proseLimit', value: 2 },
        }),
      })
      await createStory(dataDir, story)

      const marker1 = makeFragment({ id: 'mk-0001', type: 'marker', name: 'Chapter 1', content: 'Meso summary for chapter 1.' })
      const marker2 = makeFragment({ id: 'mk-0002', type: 'marker', name: 'Chapter 2', content: 'Meso summary for chapter 2.' })
      const marker3 = makeFragment({ id: 'mk-0003', type: 'marker', name: 'Chapter 3', content: 'Meso summary for chapter 3.' })
      const prose1 = makeFragment({ id: 'pr-0001', type: 'prose', content: 'Prose 1', order: 1 })
      const prose2 = makeFragment({ id: 'pr-0002', type: 'prose', content: 'Prose 2', order: 2 })
      const prose3 = makeFragment({ id: 'pr-0003', type: 'prose', content: 'Prose 3', order: 3 })
      const prose4 = makeFragment({ id: 'pr-0004', type: 'prose', content: 'Prose 4', order: 4 })
      const prose5 = makeFragment({ id: 'pr-0005', type: 'prose', content: 'Prose 5', order: 5 })

      for (const fragment of [marker1, prose1, prose2, marker2, prose3, prose4, marker3, prose5]) {
        await createFragment(dataDir, story.id, fragment)
        await addProseSection(dataDir, story.id, fragment.id)
      }

      const state = await buildContextState(dataDir, story.id, 'Continue')
      const blocks = createDefaultBlocks(state)

      const chapterSummaries = findBlock(blocks, 'chapter-summaries')
      expect(chapterSummaries).toBeDefined()
      expect(chapterSummaries!.content).toContain('Meso summary for chapter 2.')
      expect(chapterSummaries!.content).toContain('Meso summary for chapter 3.')
      expect(chapterSummaries!.content).not.toContain('Meso summary for chapter 1.')
    })

    it('does not include chapter summaries block when hierarchical summaries are disabled', async () => {
      const story = makeStory({
        settings: makeTestSettings({
          enableHierarchicalSummary: false,
        }),
      })
      await createStory(dataDir, story)

      const marker = makeFragment({ id: 'mk-0001', type: 'marker', name: 'Chapter 1', content: 'Meso summary.' })
      await createFragment(dataDir, story.id, marker)
      await addProseSection(dataDir, story.id, marker.id)

      const state = await buildContextState(dataDir, story.id, 'Continue')
      const blocks = createDefaultBlocks(state)

      expect(findBlock(blocks, 'chapter-summaries')).toBeUndefined()
    })
  })

  describe('compileBlocks', () => {
    it('groups blocks by role and produces system + user messages', () => {
      const blocks: ContextBlock[] = [
        { id: 'a', role: 'system', content: 'System A', order: 100, source: 'builtin' },
        { id: 'b', role: 'user', content: 'User B', order: 100, source: 'builtin' },
      ]

      const messages = compileBlocks(blocks)
      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('system')
      expect(messages[0].content).toBe('[@block=a]\nSystem A')
      expect(messages[1].role).toBe('user')
      expect(messages[1].content).toBe('[@block=b]\nUser B')
    })

    it('prepends [@block=id] marker to each block', () => {
      const blocks: ContextBlock[] = [
        { id: 'my-block', role: 'user', content: 'Hello', order: 100, source: 'builtin' },
      ]

      const messages = compileBlocks(blocks)
      expect(messages[0].content).toBe('[@block=my-block]\nHello')
    })

    it('sorts blocks by order and separates with blank lines', () => {
      const blocks: ContextBlock[] = [
        { id: 'b', role: 'user', content: 'Second', order: 200, source: 'builtin' },
        { id: 'a', role: 'user', content: 'First', order: 100, source: 'builtin' },
        { id: 'c', role: 'user', content: 'Third', order: 300, source: 'builtin' },
      ]

      const messages = compileBlocks(blocks)
      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe(
        '[@block=a]\nFirst\n\n[@block=b]\nSecond\n\n[@block=c]\nThird',
      )
    })

    it('omits role when no blocks of that role exist', () => {
      const blocks: ContextBlock[] = [
        { id: 'a', role: 'user', content: 'User only', order: 100, source: 'builtin' },
      ]

      const messages = compileBlocks(blocks)
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('user')
    })

    it('returns empty array for empty blocks', () => {
      expect(compileBlocks([])).toEqual([])
    })
  })

  describe('block manipulation', () => {
    const blocks: ContextBlock[] = [
      { id: 'a', role: 'system', content: 'Alpha', order: 100, source: 'builtin' },
      { id: 'b', role: 'system', content: 'Beta', order: 200, source: 'builtin' },
      { id: 'c', role: 'user', content: 'Gamma', order: 100, source: 'builtin' },
    ]

    it('findBlock returns the matching block', () => {
      expect(findBlock(blocks, 'b')).toEqual(blocks[1])
    })

    it('findBlock returns undefined for missing id', () => {
      expect(findBlock(blocks, 'missing')).toBeUndefined()
    })

    it('replaceBlockContent replaces content of target block', () => {
      const result = replaceBlockContent(blocks, 'b', 'New Beta')
      expect(findBlock(result, 'b')!.content).toBe('New Beta')
      // Original unchanged
      expect(findBlock(blocks, 'b')!.content).toBe('Beta')
    })

    it('removeBlock removes the target block', () => {
      const result = removeBlock(blocks, 'b')
      expect(result).toHaveLength(2)
      expect(findBlock(result, 'b')).toBeUndefined()
    })

    it('insertBlockBefore inserts before target', () => {
      const newBlock: ContextBlock = { id: 'x', role: 'system', content: 'X', order: 150, source: 'test' }
      const result = insertBlockBefore(blocks, 'b', newBlock)
      expect(result).toHaveLength(4)
      const ids = result.map(b => b.id)
      expect(ids).toEqual(['a', 'x', 'b', 'c'])
    })

    it('insertBlockBefore appends when target not found', () => {
      const newBlock: ContextBlock = { id: 'x', role: 'system', content: 'X', order: 150, source: 'test' }
      const result = insertBlockBefore(blocks, 'missing', newBlock)
      expect(result).toHaveLength(4)
      expect(result[result.length - 1].id).toBe('x')
    })

    it('insertBlockAfter inserts after target', () => {
      const newBlock: ContextBlock = { id: 'x', role: 'system', content: 'X', order: 150, source: 'test' }
      const result = insertBlockAfter(blocks, 'a', newBlock)
      expect(result).toHaveLength(4)
      const ids = result.map(b => b.id)
      expect(ids).toEqual(['a', 'x', 'b', 'c'])
    })

    it('insertBlockAfter appends when target not found', () => {
      const newBlock: ContextBlock = { id: 'x', role: 'system', content: 'X', order: 150, source: 'test' }
      const result = insertBlockAfter(blocks, 'missing', newBlock)
      expect(result).toHaveLength(4)
      expect(result[result.length - 1].id).toBe('x')
    })

    it('reorderBlock changes the order of target block', () => {
      const result = reorderBlock(blocks, 'a', 999)
      expect(findBlock(result, 'a')!.order).toBe(999)
      // Original unchanged
      expect(findBlock(blocks, 'a')!.order).toBe(100)
    })
  })

  describe('fidelity', () => {
    it('assembleMessages matches compileBlocks(createDefaultBlocks(...))', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      // Add some fragments for a realistic context
      await createFragment(dataDir, story.id, makeFragment({
        id: 'gl-0001', type: 'guideline', name: 'Tone', description: 'Tone rules',
        content: 'Write in a dark style.', sticky: true,
      }))
      await createFragment(dataDir, story.id, makeFragment({
        id: 'ch-0001', type: 'character', name: 'Hero', description: 'Main character',
        content: 'A brave warrior.', sticky: true,
      }))
      await createFragment(dataDir, story.id, makeFragment({
        id: 'kn-0001', type: 'knowledge', name: 'Lore', description: 'World lore',
        content: 'Dragons exist.', sticky: false,
      }))
      await createFragment(dataDir, story.id, makeFragment({
        id: 'pr-0001', type: 'prose', name: 'Ch1', content: 'The story begins.', order: 1,
      }))
      await createFragment(dataDir, story.id, makeFragment({
        id: 'pr-0002', type: 'prose', name: 'Ch2', content: 'The adventure continues.', order: 2,
      }))

      const state = await buildContextState(dataDir, story.id, 'Make the dragon appear')

      const fromAssemble = assembleMessages(state)
      const fromBlocks = compileBlocks(createDefaultBlocks(state))

      expect(fromBlocks).toEqual(fromAssemble)
    })
  })

  describe('addCacheBreakpoints', () => {
    it('adds cache control to system message', () => {
      const messages: ContextMessage[] = [
        { role: 'system', content: 'You are a writing assistant.' },
      ]

      const result = addCacheBreakpoints(messages)

      expect(result).toHaveLength(1)
      expect(result[0].role).toBe('system')
      expect(result[0].content).toBe('You are a writing assistant.')
      expect(result[0].providerOptions).toEqual({
        anthropic: { cacheControl: { type: 'ephemeral' } },
      })
    })

    it('splits user message at author-input marker', () => {
      const messages: ContextMessage[] = [
        {
          role: 'user',
          content: '[@block=story-info]\n## Story: Test\n\n[@block=author-input]\nThe author wants the following to happen next: Continue',
        },
      ]

      const result = addCacheBreakpoints(messages)

      expect(result).toHaveLength(1)
      expect(result[0].role).toBe('user')
      expect(Array.isArray(result[0].content)).toBe(true)

      const parts = result[0].content as Array<{ type: string; text: string; providerOptions?: unknown }>
      expect(parts).toHaveLength(2)

      // Stable prefix has cache control
      expect(parts[0].type).toBe('text')
      expect(parts[0].text).toBe('[@block=story-info]\n## Story: Test')
      expect(parts[0].providerOptions).toEqual({
        anthropic: { cacheControl: { type: 'ephemeral' } },
      })

      // Volatile suffix has no cache control
      expect(parts[1].type).toBe('text')
      expect(parts[1].text).toContain('[@block=author-input]')
      expect(parts[1].text).toContain('Continue')
      expect(parts[1].providerOptions).toBeUndefined()
    })

    it('falls back to single string when author-input marker not found', () => {
      const messages: ContextMessage[] = [
        { role: 'user', content: 'Some content without marker' },
      ]

      const result = addCacheBreakpoints(messages)

      expect(result).toHaveLength(1)
      expect(result[0].role).toBe('user')
      expect(result[0].content).toBe('Some content without marker')
    })

    it('passes through assistant messages unchanged', () => {
      const messages: ContextMessage[] = [
        { role: 'assistant', content: 'Once upon a time...' },
      ]

      const result = addCacheBreakpoints(messages)

      expect(result).toHaveLength(1)
      expect(result[0].role).toBe('assistant')
      expect(result[0].content).toBe('Once upon a time...')
    })

    it('handles full system + user message pair', () => {
      const messages: ContextMessage[] = [
        { role: 'system', content: 'System instructions here.' },
        {
          role: 'user',
          content: '[@block=story-info]\nStory info\n\n[@block=prose]\nSome prose\n\n[@block=author-input]\nThe author wants the following to happen next: Write more',
        },
      ]

      const result = addCacheBreakpoints(messages)

      expect(result).toHaveLength(2)

      // System message has cache control
      expect(result[0].providerOptions).toEqual({
        anthropic: { cacheControl: { type: 'ephemeral' } },
      })

      // User message is split into parts
      const parts = result[1].content as Array<{ type: string; text: string; providerOptions?: unknown }>
      expect(parts).toHaveLength(2)
      expect(parts[0].text).toContain('Story info')
      expect(parts[0].text).toContain('Some prose')
      expect(parts[0].text).not.toContain('Write more')
      expect(parts[1].text).toContain('Write more')
    })
  })
})
