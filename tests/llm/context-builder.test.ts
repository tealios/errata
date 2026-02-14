import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir } from '../setup'
import {
  createStory,
  createFragment,
} from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'
import { buildContext, type ContextBuildState } from '@/server/llm/context-builder'

function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    summary: 'The hero embarked on a journey.',
    createdAt: now,
    updatedAt: now,
    settings: { outputFormat: 'markdown', enabledPlugins: [], summarizationThreshold: 4, maxSteps: 10, providerId: null, modelId: null, contextOrderMode: 'simple' as const, fragmentOrder: [] },
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

    // System message should list available tools
    expect(sysMsg.content).toContain('getCharacter')
    expect(sysMsg.content).toContain('listCharacters')
    expect(sysMsg.content).toContain('creative writing assistant')
  })
})
