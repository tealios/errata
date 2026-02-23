import { describe, it, expect, vi } from 'vitest'
import { createEmptyCollector, createAnalysisTools, updateSummaryInputSchema } from '@/server/librarian/analysis-tools'

vi.mock('@/server/fragments/storage', () => ({
  getFragment: vi.fn().mockResolvedValue(null),
  updateFragmentVersioned: vi.fn().mockResolvedValue(null),
}))

describe('analysis-tools', () => {
  describe('createEmptyCollector', () => {
    it('creates a collector with empty fields', () => {
      const collector = createEmptyCollector()
      expect(collector.summaryUpdate).toBe('')
      expect(collector.structuredSummary).toEqual({
        events: [],
        stateChanges: [],
        openThreads: [],
      })
      expect(collector.mentions).toEqual([])
      expect(collector.contradictions).toEqual([])
      expect(collector.fragmentSuggestions).toEqual([])
      expect(collector.timelineEvents).toEqual([])
    })
  })

  describe('createAnalysisTools', () => {
    it('returns all six tools', () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      expect(Object.keys(tools)).toEqual([
        'updateSummary',
        'reportMentions',
        'reportContradictions',
        'suggestFragment',
        'reportTimeline',
        'updateFragment',
        'suggestDirections',
      ])
    })

    it('updateSummary sets summary (last call wins)', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      const result1 = await tools.updateSummary.execute!({ summary: 'First summary' }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(result1).toEqual({ ok: true })
      expect(collector.summaryUpdate).toBe('First summary')

      await tools.updateSummary.execute!({ summary: 'Second summary' }, { toolCallId: 'b', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.summaryUpdate).toBe('Second summary')
    })

    it('updateSummary accepts structured signals and derives canonical summary when summary is empty', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)

      await tools.updateSummary.execute!({
        summary: '   ',
        events: ['Found the map', 'Found the map', 'Met the guide'],
        stateChanges: ['Trust in the guide increased'],
        openThreads: ['Who sent the letter?'],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })

      expect(collector.structuredSummary).toEqual({
        events: ['Found the map', 'Met the guide'],
        stateChanges: ['Trust in the guide increased'],
        openThreads: ['Who sent the letter?'],
      })
      expect(collector.summaryUpdate).toContain('Events: Found the map; Met the guide.')
      expect(collector.summaryUpdate).toContain('State changes: Trust in the guide increased.')
      expect(collector.summaryUpdate).toContain('Open threads: Who sent the letter?.')
    })

    it('updateSummary rejects empty payload with no summary and no structured signals', async () => {
      await expect(
        updateSummaryInputSchema.parseAsync({
          summary: '  ',
          events: [],
          stateChanges: [],
          openThreads: [],
        }),
      ).rejects.toThrow()
    })

    it('reportMentions accumulates mentions and deduplicates by characterId', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      await tools.reportMentions.execute!({
        mentions: [
          { characterId: 'ch-001', text: 'Alice' },
          { characterId: 'ch-002', text: 'Bob' },
        ],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.mentions).toHaveLength(2)

      // Second call with duplicate ch-001 — should be ignored
      await tools.reportMentions.execute!({
        mentions: [{ characterId: 'ch-001', text: 'Detective' }],
      }, { toolCallId: 'b', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.mentions).toHaveLength(2)
      expect(collector.mentions[0].text).toBe('Alice') // keeps first mention text

      // New character is still added
      await tools.reportMentions.execute!({
        mentions: [{ characterId: 'ch-003', text: 'Carol' }],
      }, { toolCallId: 'c', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.mentions).toHaveLength(3)
    })

    it('reportContradictions accumulates contradictions', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      await tools.reportContradictions.execute!({
        contradictions: [{
          description: 'Eye color mismatch',
          fragmentIds: ['pr-001'],
        }],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.contradictions).toHaveLength(1)
      expect(collector.contradictions[0].description).toBe('Eye color mismatch')
    })

    it('suggestFragment accumulates suggestions', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      await tools.suggestFragment.execute!({
        suggestions: [{
          type: 'knowledge',
          name: 'Valdris',
          description: 'Ancient city',
          content: 'Valdris is ancient.',
        }],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.fragmentSuggestions).toHaveLength(1)
      expect(collector.fragmentSuggestions[0].name).toBe('Valdris')
    })

    it('suggestFragment handles targetFragmentId', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      await tools.suggestFragment.execute!({
        suggestions: [{
          type: 'character',
          targetFragmentId: 'ch-001',
          name: 'Alice',
          description: 'Updated',
          content: 'Alice is now a warrior.',
        }],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.fragmentSuggestions[0].targetFragmentId).toBe('ch-001')
      expect(collector.fragmentSuggestions[0].type).toBe('character')
    })

    it('reportTimeline accumulates timeline events', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      await tools.reportTimeline.execute!({
        events: [
          { event: 'Battle started', position: 'during' },
          { event: 'Flashback', position: 'before' },
        ],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.timelineEvents).toHaveLength(2)
      expect(collector.timelineEvents[0].position).toBe('during')
      expect(collector.timelineEvents[1].position).toBe('before')
    })

    it('suggestDirections records directions', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      await tools.suggestDirections.execute!({
        directions: [
          { title: 'Into the forest', description: 'The hero enters the dark forest.', instruction: 'Write a scene where the hero enters the dark forest.' },
          { title: 'A stranger arrives', description: 'A mysterious stranger appears.', instruction: 'Introduce a mysterious stranger who approaches the hero.' },
          { title: 'Inner reflection', description: 'The hero reflects on past choices.', instruction: 'Write an introspective passage about the hero reflecting on their past.' },
        ],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.directions).toHaveLength(3)
      expect(collector.directions[0].title).toBe('Into the forest')
      expect(collector.directions[2].instruction).toContain('introspective')
    })

    it('suggestFragment skips suggestions targeting a locked fragment', async () => {
      const { getFragment } = await import('@/server/fragments/storage')
      vi.mocked(getFragment).mockResolvedValueOnce({
        id: 'ch-locked',
        type: 'character',
        name: 'Locked Char',
        description: '',
        content: 'Original content',
        tags: [],
        refs: [],
        sticky: false,
        placement: 'user',
        createdAt: '',
        updatedAt: '',
        order: 0,
        meta: { locked: true },
        version: 1,
        versions: [],
      })

      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector, { dataDir: '/tmp', storyId: 'test-story' })
      const result = await tools.suggestFragment.execute!({
        suggestions: [{
          type: 'character',
          targetFragmentId: 'ch-locked',
          name: 'Locked Char',
          description: 'Updated',
          content: 'New content',
        }],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })

      expect(collector.fragmentSuggestions).toHaveLength(0)
      expect(result).toHaveProperty('skipped')
      expect((result as any).skipped).toHaveLength(1)
      expect((result as any).skipped[0].name).toBe('Locked Char')
    })

    it('suggestFragment skips suggestions that violate frozen sections', async () => {
      const { getFragment } = await import('@/server/fragments/storage')
      vi.mocked(getFragment).mockResolvedValueOnce({
        id: 'kn-frozen',
        type: 'knowledge',
        name: 'Frozen Entry',
        description: '',
        content: 'The ancient city of Valdris stands eternal.',
        tags: [],
        refs: [],
        sticky: false,
        placement: 'user',
        createdAt: '',
        updatedAt: '',
        order: 0,
        meta: {
          frozenSections: [{ id: 'fs-1', text: 'The ancient city of Valdris stands eternal.' }],
        },
        version: 1,
        versions: [],
      })

      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector, { dataDir: '/tmp', storyId: 'test-story' })
      const result = await tools.suggestFragment.execute!({
        suggestions: [{
          type: 'knowledge',
          targetFragmentId: 'kn-frozen',
          name: 'Frozen Entry',
          description: 'Updated',
          content: 'Valdris was destroyed long ago.',
        }],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })

      expect(collector.fragmentSuggestions).toHaveLength(0)
      expect((result as any).skipped).toHaveLength(1)
      expect((result as any).skipped[0].reason).toContain('Frozen section')
    })

    it('suggestFragment allows suggestions that preserve frozen sections', async () => {
      const { getFragment } = await import('@/server/fragments/storage')
      vi.mocked(getFragment).mockResolvedValueOnce({
        id: 'kn-frozen',
        type: 'knowledge',
        name: 'Frozen Entry',
        description: '',
        content: 'The ancient city of Valdris stands eternal.',
        tags: [],
        refs: [],
        sticky: false,
        placement: 'user',
        createdAt: '',
        updatedAt: '',
        order: 0,
        meta: {
          frozenSections: [{ id: 'fs-1', text: 'The ancient city of Valdris stands eternal.' }],
        },
        version: 1,
        versions: [],
      })

      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector, { dataDir: '/tmp', storyId: 'test-story' })
      const result = await tools.suggestFragment.execute!({
        suggestions: [{
          type: 'knowledge',
          targetFragmentId: 'kn-frozen',
          name: 'Frozen Entry',
          description: 'Updated with more detail',
          content: 'The ancient city of Valdris stands eternal. It was founded in the First Age.',
        }],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })

      expect(collector.fragmentSuggestions).toHaveLength(1)
      expect(result).toEqual({ ok: true })
    })
  })
})
