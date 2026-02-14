import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the agent module so runLibrarian doesn't actually call LLM
vi.mock('@/server/librarian/agent', () => ({
  runLibrarian: vi.fn(),
}))

import { runLibrarian } from '@/server/librarian/agent'
import { triggerLibrarian, clearPending, getPendingCount } from '@/server/librarian/scheduler'
import type { Fragment } from '@/server/fragments/schema'

const mockedRunLibrarian = vi.mocked(runLibrarian)

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
    mockedRunLibrarian.mockResolvedValue({
      id: 'la-test',
      createdAt: new Date().toISOString(),
      fragmentId: 'pr-0001',
      summaryUpdate: '',
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    })
  })

  afterEach(() => {
    clearPending()
    vi.useRealTimers()
  })

  it('triggers runLibrarian after debounce period', async () => {
    triggerLibrarian('/data', 'story-1', makeFragment('pr-0001'))

    expect(mockedRunLibrarian).not.toHaveBeenCalled()
    expect(getPendingCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(2000)

    expect(mockedRunLibrarian).toHaveBeenCalledTimes(1)
    expect(mockedRunLibrarian).toHaveBeenCalledWith('/data', 'story-1', 'pr-0001')
    expect(getPendingCount()).toBe(0)
  })

  it('debounces multiple rapid triggers for the same story', async () => {
    triggerLibrarian('/data', 'story-1', makeFragment('pr-0001'))
    triggerLibrarian('/data', 'story-1', makeFragment('pr-0002'))
    triggerLibrarian('/data', 'story-1', makeFragment('pr-0003'))

    expect(getPendingCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(2000)

    // Only the last fragment should be used
    expect(mockedRunLibrarian).toHaveBeenCalledTimes(1)
    expect(mockedRunLibrarian).toHaveBeenCalledWith('/data', 'story-1', 'pr-0003')
  })

  it('runs independently for different stories', async () => {
    triggerLibrarian('/data', 'story-1', makeFragment('pr-0001'))
    triggerLibrarian('/data', 'story-2', makeFragment('pr-0002'))

    expect(getPendingCount()).toBe(2)

    await vi.advanceTimersByTimeAsync(2000)

    expect(mockedRunLibrarian).toHaveBeenCalledTimes(2)
    expect(mockedRunLibrarian).toHaveBeenCalledWith('/data', 'story-1', 'pr-0001')
    expect(mockedRunLibrarian).toHaveBeenCalledWith('/data', 'story-2', 'pr-0002')
  })

  it('does not propagate errors from runLibrarian', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedRunLibrarian.mockRejectedValue(new Error('LLM failed'))

    triggerLibrarian('/data', 'story-1', makeFragment('pr-0001'))

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
    triggerLibrarian('/data', 'story-1', makeFragment('pr-0001'))
    triggerLibrarian('/data', 'story-2', makeFragment('pr-0002'))

    expect(getPendingCount()).toBe(2)
    clearPending()
    expect(getPendingCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(5000)

    expect(mockedRunLibrarian).not.toHaveBeenCalled()
  })
})
