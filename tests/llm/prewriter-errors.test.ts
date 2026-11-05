import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { ensureCoreAgentsRegistered } from '@/server/agents/register-core'
import { createTempDir, seedTestProvider, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'

const { mockAgentStream } = vi.hoisted(() => ({ mockAgentStream: vi.fn() }))

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    ToolLoopAgent: class {
      stream(args: unknown) { return mockAgentStream(args) }
    },
  }
})

import { runPrewriter } from '@/server/llm/prewriter'

describe('prewriter stream errors', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeAll(() => ensureCoreAgentsRegistered())
  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await seedTestProvider(dataDir)
    const now = new Date().toISOString()
    await createStory(dataDir, {
      id: 's1', name: 'S', description: '', coverImage: null, summary: '',
      createdAt: now, updatedAt: now, settings: makeTestSettings({ generationMode: 'prewriter' }),
    })
  })
  afterEach(async () => { await cleanup() })

  it('throws instead of returning an empty brief when the stream errors', async () => {
    mockAgentStream.mockImplementation(async () => ({
      fullStream: (async function* () {
        yield { type: 'error' as const, error: new Error('rate limited') }
      })(),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    }))
    await expect(runPrewriter({
      dataDir, storyId: 's1', compiledMessages: [], authorInput: 'go', mode: 'continue', tools: {},
    } as never)).rejects.toThrow('rate limited')
  })
})
