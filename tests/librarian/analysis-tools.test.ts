import { describe, it, expect } from 'vitest'
import { createEmptyCollector, createAnalysisTools, updateSummaryInputSchema } from '@/server/librarian/analysis-tools'

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
      expect(collector.knowledgeSuggestions).toEqual([])
      expect(collector.timelineEvents).toEqual([])
    })
  })

  describe('createAnalysisTools', () => {
    it('returns all five tools', () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      expect(Object.keys(tools)).toEqual([
        'updateSummary',
        'reportMentions',
        'reportContradictions',
        'suggestKnowledge',
        'reportTimeline',
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

    it('reportMentions accumulates mentions', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      await tools.reportMentions.execute!({
        mentions: [
          { characterId: 'ch-001', text: 'Alice' },
          { characterId: 'ch-002', text: 'Bob' },
        ],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.mentions).toHaveLength(2)

      await tools.reportMentions.execute!({
        mentions: [{ characterId: 'ch-001', text: 'Detective' }],
      }, { toolCallId: 'b', messages: [], abortSignal: undefined as unknown as AbortSignal })
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

    it('suggestKnowledge accumulates suggestions', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      await tools.suggestKnowledge.execute!({
        suggestions: [{
          type: 'knowledge',
          name: 'Valdris',
          description: 'Ancient city',
          content: 'Valdris is ancient.',
        }],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.knowledgeSuggestions).toHaveLength(1)
      expect(collector.knowledgeSuggestions[0].name).toBe('Valdris')
    })

    it('suggestKnowledge handles targetFragmentId', async () => {
      const collector = createEmptyCollector()
      const tools = createAnalysisTools(collector)
      await tools.suggestKnowledge.execute!({
        suggestions: [{
          type: 'character',
          targetFragmentId: 'ch-001',
          name: 'Alice',
          description: 'Updated',
          content: 'Alice is now a warrior.',
        }],
      }, { toolCallId: 'a', messages: [], abortSignal: undefined as unknown as AbortSignal })
      expect(collector.knowledgeSuggestions[0].targetFragmentId).toBe('ch-001')
      expect(collector.knowledgeSuggestions[0].type).toBe('character')
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
  })
})
