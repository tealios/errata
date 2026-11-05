import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTempDir, makeTestSettings, seedTestProvider } from '../setup'
import { createFragment, createStory, getStory, listFragments } from '@/server/fragments/storage'
import { getProseChain } from '@/server/fragments/prose-chain'
import { syncStorySetupSnapshot } from '@/server/story-setup/sync'
import type { StoryMeta } from '@/server/fragments/schema'

const { mockAgentCtor, mockAgentStream, mockGenerateText } = vi.hoisted(() => ({
  mockAgentCtor: vi.fn(),
  mockAgentStream: vi.fn(),
  mockGenerateText: vi.fn(),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: mockGenerateText,
    ToolLoopAgent: class MockToolLoopAgent {
      constructor(config: unknown) {
        mockAgentCtor(config)
      }

      stream = mockAgentStream
    },
  }
})

import { createApp } from '@/server/api'

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-setup-test',
    name: 'New Story',
    description: '',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
  }
}

async function* fullStream(text: string) {
  yield { type: 'text-delta', text }
  yield { type: 'finish', finishReason: 'stop' }
}

function mockChatResponse(text: string) {
  mockAgentStream.mockResolvedValue({
    fullStream: fullStream(text),
    text: Promise.resolve(text),
    reasoning: Promise.resolve(''),
    toolCalls: Promise.resolve([]),
    finishReason: Promise.resolve('stop'),
    steps: Promise.resolve([]),
    totalUsage: Promise.resolve(undefined),
  })
}

describe('story setup routes', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await seedTestProvider(dataDir)
    await createStory(dataDir, makeStory())
    app = createApp(dataDir)
  })

  afterEach(async () => {
    await cleanup()
  })

  it('lets the model open the conversation with a focused question', async () => {
    mockChatResponse('What are you starting with: a premise, a character, a scene, or only a mood?')

    const response = await app.fetch(new Request(
      'http://localhost/api/stories/story-setup-test/setup/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      },
    ))

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('What are you starting with')
    expect(mockAgentCtor).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.stringMatching(/one focused question at a time[\s\S]*Starting point[\s\S]*Opening direction/),
      tools: expect.objectContaining({
        updateStorySetup: expect.anything(),
      }),
    }))
    expect(mockAgentStream).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: expect.stringContaining('Begin the story setup conversation') }],
    }))
  })

  it('includes existing setup fragments when the writer returns to refine the story', async () => {
    await syncStorySetupSnapshot(dataDir, 'story-setup-test', {
      story: { name: 'The Memory Courier', description: 'A courier carries a stolen memory.' },
      fragments: [{
        key: 'mara',
        type: 'character',
        name: 'Mara',
        description: 'Courier with a stolen memory',
        content: 'Mara is cautious and wants to learn who altered her childhood.',
      }],
    })
    mockChatResponse('What would you like to sharpen about Mara?')

    const response = await app.fetch(new Request(
      'http://localhost/api/stories/story-setup-test/setup/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      },
    ))

    expect(response.status).toBe(200)
    expect(mockAgentCtor).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.stringMatching(/Existing story setup fragments[\s\S]*Mara[\s\S]*altered her childhood/),
    }))
  })

  it('includes writer-created character and guideline fragments as read-only context', async () => {
    const now = new Date().toISOString()
    await createFragment(dataDir, 'story-setup-test', {
      id: 'ch-orin',
      type: 'character',
      name: 'Orin Vale',
      description: 'Cartographer hiding a royal lineage',
      content: 'Orin refuses every title and maps roads that no longer exist.',
      tags: [],
      refs: [],
      sticky: false,
      placement: 'user',
      createdAt: now,
      updatedAt: now,
      order: 0,
      meta: {},
      archived: false,
      version: 1,
      versions: [],
    })
    await createFragment(dataDir, 'story-setup-test', {
      id: 'gl-voice',
      type: 'guideline',
      name: 'Narrative voice',
      description: 'Close third person in present tense',
      content: 'Stay close to Orin and keep the prose restrained and tactile.',
      tags: [],
      refs: [],
      sticky: true,
      placement: 'system',
      createdAt: now,
      updatedAt: now,
      order: 1,
      meta: {},
      archived: false,
      version: 1,
      versions: [],
    })
    mockChatResponse('What danger is Orin mapping toward?')

    const response = await app.fetch(new Request(
      'http://localhost/api/stories/story-setup-test/setup/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      },
    ))

    expect(response.status).toBe(200)
    expect(mockAgentCtor).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.stringMatching(
        /Existing writer-created fragments[\s\S]*Orin Vale[\s\S]*roads that no longer exist[\s\S]*Narrative voice[\s\S]*restrained and tactile/,
      ),
    }))
  })

  it('streams checklist progress and draft fragments with the next question', async () => {
    async function* checklistStream() {
      yield {
        type: 'tool-call',
        toolCallId: 'checklist-1',
        toolName: 'updateStorySetup',
        input: {
          checklist: [
            { key: 'starting-point', status: 'covered', note: 'A stolen memory premise' },
            { key: 'characters', status: 'partial', note: 'Mara needs motivation' },
          ],
          fragments: [{
            key: 'mara',
            type: 'character',
            name: 'Mara',
            description: 'Courier carrying a stolen memory',
            content: 'Mara is a courier whose motivation is still undecided.',
          }],
        },
      }
      yield {
        type: 'tool-result',
        toolCallId: 'checklist-1',
        toolName: 'updateStorySetup',
        output: { accepted: true },
      }
      yield { type: 'text-delta', text: 'What does Mara want badly enough to take this risk?' }
      yield { type: 'finish', finishReason: 'stop' }
    }

    mockAgentStream.mockResolvedValue({
      fullStream: checklistStream(),
      text: Promise.resolve('What does Mara want badly enough to take this risk?'),
      reasoning: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
      steps: Promise.resolve([]),
      totalUsage: Promise.resolve(undefined),
    })

    const response = await app.fetch(new Request(
      'http://localhost/api/stories/story-setup-test/setup/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'A courier named Mara carrying a stolen memory.' }],
        }),
      },
    ))

    const events = (await response.text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool-call',
      toolName: 'updateStorySetup',
      args: expect.objectContaining({
        checklist: expect.arrayContaining([
          expect.objectContaining({ key: 'starting-point', status: 'covered' }),
        ]),
        fragments: expect.arrayContaining([
          expect.objectContaining({ type: 'character', name: 'Mara' }),
        ]),
      }),
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('What does Mara want'),
    }))
  })

  it('passes the full setup conversation back to the model', async () => {
    mockChatResponse('What does Mara want badly enough to risk that?')
    const messages = [
      { role: 'assistant', content: 'What are you starting with?' },
      { role: 'user', content: 'A courier named Mara carrying a stolen memory.' },
    ]

    const response = await app.fetch(new Request(
      'http://localhost/api/stories/story-setup-test/setup/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      },
    ))

    expect(response.status).toBe(200)
    expect(mockAgentStream).toHaveBeenCalledWith(expect.objectContaining({ messages }))
  })

  it('turns the conversation into validated story fragments only when requested', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [{
        toolName: 'submitStorySetupPlan',
        input: {
        name: 'The Memory Courier',
        description: 'A courier must deliver a stolen memory before it rewrites her past.',
        guideline: 'Close third person through Mara. Tense, tactile prose with restrained exposition.',
        knowledge: [{
          name: 'Memory trade',
          description: 'Rules of bought memories',
          content: 'Memories can be copied, sold, and altered. Copies decay each time they change hands.',
        }],
        characters: [{
          name: 'Mara Venn',
          description: 'Courier with a missing past',
          content: 'Mara is a careful black-market courier who has gaps in her own childhood memories.',
        }],
        opening: 'Mara knew the memory was stolen because it was still warm.',
        },
      }],
      totalUsage: undefined,
    })

    const response = await app.fetch(new Request(
      'http://localhost/api/stories/story-setup-test/setup/complete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'assistant', content: 'What are you starting with?' },
            { role: 'user', content: 'A courier named Mara carrying a stolen memory.' },
          ],
          draftFragments: [{
            key: 'mara',
            type: 'character',
            name: 'Mara Venn',
            description: 'Courier with a missing past',
            content: 'Mara is a careful black-market courier.',
          }],
        }),
      },
    ))

    expect(response.status).toBe(200)
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('Mara Venn'),
      tools: expect.objectContaining({ submitStorySetupPlan: expect.anything() }),
      toolChoice: { type: 'tool', toolName: 'submitStorySetupPlan' },
    }))
    expect(mockGenerateText.mock.calls[0][0]).not.toHaveProperty('output')
    const body = await response.json() as { created: Array<{ type: string; name: string }> }
    expect(body.created.map(item => item.type)).toEqual([
      'guideline',
      'knowledge',
      'character',
      'prose',
    ])

    const story = await getStory(dataDir, 'story-setup-test')
    expect(story?.name).toBe('The Memory Courier')
    expect(story?.description).toContain('stolen memory')

    const fragments = await listFragments(dataDir, 'story-setup-test')
    expect(fragments).toHaveLength(4)
    expect(fragments.find(fragment => fragment.type === 'guideline')).toMatchObject({
      sticky: true,
      placement: 'system',
    })
    expect(fragments.find(fragment => fragment.type === 'character')).toMatchObject({
      sticky: true,
      name: 'Mara Venn',
    })

    const chain = await getProseChain(dataDir, 'story-setup-test')
    expect(chain?.entries).toHaveLength(1)
  })

  it('requires at least one user answer before creating the story', async () => {
    const response = await app.fetch(new Request(
      'http://localhost/api/stories/story-setup-test/setup/complete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'assistant', content: 'What are you starting with?' }],
        }),
      },
    ))

    expect(response.status).toBe(422)
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('replays recorded tool activity next to earlier assistant turns', async () => {
    mockChatResponse('Who else lives in the city?')
    const messages = [
      { role: 'user', content: 'Add fifteen side characters.' },
      {
        role: 'assistant',
        content: 'Added them all.',
        toolCalls: [{ toolName: 'updateStorySetup', args: {}, error: 'Invalid input: too many fragments' }],
      },
      { role: 'user', content: 'I do not see them.' },
    ]

    const response = await app.fetch(new Request(
      'http://localhost/api/stories/story-setup-test/setup/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      },
    ))

    expect(response.status).toBe(200)
    const call = mockAgentStream.mock.calls.at(-1)?.[0] as { messages: Array<{ role: string; content: string }> }
    expect(call.messages[1].role).toBe('assistant')
    expect(call.messages[1].content).toMatch(/Added them all\.[\s\S]*updateStorySetup[\s\S]*failed[\s\S]*too many fragments/)
    expect(call.messages[2]).toEqual({ role: 'user', content: 'I do not see them.' })
  })
})
