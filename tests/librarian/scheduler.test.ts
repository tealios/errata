import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the agent runner so scheduler doesn't execute real agents
vi.mock('@/server/agents', () => ({
  invokeAgent: vi.fn(),
}))

// Mock the branches module — scheduler now resolves branch before debounce
vi.mock('@/server/fragments/branches', () => ({
  getActiveBranchId: vi.fn().mockResolvedValue('main'),
  withBranch: vi.fn((_dataDir: string, _storyId: string, fn: () => Promise<unknown>, _branchId?: string) => fn()),
}))

// Import mocked modules AFTER vi.mock (vitest hoists mocks to top)
import { invokeAgent } from '@/server/agents'
import { triggerLibrarian, clearPending, getPendingCount, getLibrarianRuntimeStatus } from '@/server/librarian/scheduler'
import type { Fragment } from '@/server/fragments/schema'

const mockedInvokeAgent = vi.mocked(invokeAgent)

function makeFragment(id: string): Fragment {
  const now = new Date().toISOString()
  return {
    id,
    type: 'prose',
    name: 'Test',
    description: 'test',
    content: 'content',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user' as const,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
  }
}

describe('librarian scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    clearPending()
    mockedInvokeAgent.mockResolvedValue({
      runId: 'ar-test',
      output: {
        id: 'la-test',
        createdAt: new Date().toISOString(),
        fragmentId: 'pr-0001',
        summaryUpdate: '',
        mentionedCharacters: [],
        contradictions: [],
        knowledgeSuggestions: [],
        timelineEvents: [],
      },
      trace: [],
    })
  })

  afterEach(() => {
    clearPending()
    vi.useRealTimers()
  })

  it('triggers librarian analyze agent after debounce period', async () => {
    await triggerLibrarian('/data', 'story-1', makeFragment('pr-0001'))

    expect(mockedInvokeAgent).not.toHaveBeenCalled()
    expect(getPendingCount()).toBe(1)
    expect(getLibrarianRuntimeStatus('story-1').runStatus).toBe('scheduled')

    await vi.advanceTimersByTimeAsync(2000)

    expect(mockedInvokeAgent).toHaveBeenCalledTimes(1)
    expect(mockedInvokeAgent).toHaveBeenCalledWith({
      dataDir: '/data',
      storyId: 'story-1',
      agentName: 'librarian.analyze',
      input: { fragmentId: 'pr-0001' },
    })
    expect(getPendingCount()).toBe(0)
    expect(getLibrarianRuntimeStatus('story-1').runStatus).toBe('idle')
  })

  it('debounces multiple rapid triggers for the same story', async () => {
    await triggerLibrarian('/data', 'story-1', makeFragment('pr-0001'))
    await triggerLibrarian('/data', 'story-1', makeFragment('pr-0002'))
    await triggerLibrarian('/data', 'story-1', makeFragment('pr-0003'))

    expect(getPendingCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(2000)

    // Only the last fragment should be used
    expect(mockedInvokeAgent).toHaveBeenCalledTimes(1)
    expect(mockedInvokeAgent).toHaveBeenCalledWith({
      dataDir: '/data',
      storyId: 'story-1',
      agentName: 'librarian.analyze',
      input: { fragmentId: 'pr-0003' },
    })
  })

  it('runs independently for different stories', async () => {
    await triggerLibrarian('/data', 'story-1', makeFragment('pr-0001'))
    await triggerLibrarian('/data', 'story-2', makeFragment('pr-0002'))

    expect(getPendingCount()).toBe(2)

    await vi.advanceTimersByTimeAsync(2000)

    expect(mockedInvokeAgent).toHaveBeenCalledTimes(2)
    expect(mockedInvokeAgent).toHaveBeenCalledWith({
      dataDir: '/data',
      storyId: 'story-1',
      agentName: 'librarian.analyze',
      input: { fragmentId: 'pr-0001' },
    })
    expect(mockedInvokeAgent).toHaveBeenCalledWith({
      dataDir: '/data',
      storyId: 'story-2',
      agentName: 'librarian.analyze',
      input: { fragmentId: 'pr-0002' },
    })
  })

  it('does not propagate errors from agent runner', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedInvokeAgent.mockRejectedValue(new Error('LLM failed'))

    await triggerLibrarian('/data', 'story-1', makeFragment('pr-0001'))

    // Should not throw
    await vi.advanceTimersByTimeAsync(2000)

    // Should log error with new structured format
    expect(consoleSpy).toHaveBeenCalled()
    const errorCall = consoleSpy.mock.calls.find(call => 
      call[0]?.includes && call[0].includes('Librarian analysis failed')
    )
    expect(errorCall).toBeDefined()
    consoleSpy.mockRestore()
  })

  it('clearPending cancels all pending runs', async () => {
    await triggerLibrarian('/data', 'story-1', makeFragment('pr-0001'))
    await triggerLibrarian('/data', 'story-2', makeFragment('pr-0002'))

    expect(getPendingCount()).toBe(2)
    clearPending()
    expect(getPendingCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(5000)

    expect(mockedInvokeAgent).not.toHaveBeenCalled()
  })
})
