import { describe, it, expect } from 'vitest'
import {
  parseCardJson,
  isTavernCardJson,
  buildImportableItems,
  inferEntryType,
  type TavernCardData,
  type CharacterBook,
  type CharacterBookEntry,
} from '../../src/lib/importers/tavern-card'

// ── Test card fixtures ────────────────────────────────────────────────

const SAMPLE_CARD_V2_JSON = {
  data: {
    name: 'TestChar',
    description: 'A test character for unit testing.',
    personality: 'Brave and curious.',
    first_mes: 'Hello, traveler!',
    mes_example: '',
    scenario: 'You meet them in a tavern.',
    creator_notes: 'Created for testing.',
    system_prompt: 'You are a helpful assistant.',
    post_history_instructions: '',
    alternate_greetings: ['Hi there!', 'Greetings.'],
    tags: ['test', 'fantasy'],
    creator: 'test-author',
    character_version: '1.0',
  },
  spec: 'chara_card_v2',
  spec_version: '2.0',
}

const SAMPLE_CARD_V3_WITH_BOOK = {
  data: {
    name: 'WorldChar',
    description: 'A character with a rich world.',
    personality: 'Wise and ancient.',
    first_mes: 'Welcome to the realm.',
    mes_example: '',
    scenario: 'An epic adventure begins.',
    creator_notes: '',
    system_prompt: 'Narrate in third person.',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: ['world', 'lore'],
    creator: 'world-builder',
    character_version: '2.0',
    character_book: {
      name: 'World Lore',
      entries: [
        {
          keys: ['tavern', 'inn'],
          secondary_keys: ['drink', 'ale'],
          content: 'The Golden Mug is a famous tavern in the capital city.',
          comment: 'Location lore',
          name: 'The Golden Mug',
          enabled: true,
          constant: false,
          selective: true,
          insertion_order: 100,
          position: 'after_char',
          priority: 10,
          id: 1,
        },
        {
          keys: ['king', 'ruler', 'monarch'],
          secondary_keys: [],
          content: 'King Aldric rules the northern kingdoms with an iron fist.',
          comment: '',
          name: 'King Aldric',
          enabled: true,
          constant: false,
          selective: false,
          insertion_order: 200,
          position: '',
          priority: 20,
          id: 2,
        },
        {
          keys: ['magic', 'spell'],
          secondary_keys: ['arcane'],
          content: 'All magic in this world comes from ancient runes carved in stone.',
          comment: 'Magic system',
          name: '',
          enabled: true,
          constant: true,
          selective: false,
          insertion_order: 50,
          position: 'before_char',
          priority: 30,
          id: 3,
        },
        {
          keys: ['dragon'],
          secondary_keys: [],
          content: 'Dragons are extinct but their bones litter the landscape.',
          comment: '',
          name: '',
          enabled: false,
          constant: false,
          selective: false,
          insertion_order: 300,
          position: '',
          priority: 5,
          id: 4,
        },
      ],
    },
  },
  spec: 'chara_card_v3',
  spec_version: '3.0',
}

const MINIMAL_CARD = {
  data: {
    name: 'Minimal',
    description: 'Just a name and description.',
    personality: '',
    first_mes: '',
    mes_example: '',
    scenario: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '',
  },
  spec: 'chara_card_v2',
  spec_version: '2.0',
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('tavern-card JSON importer', () => {
  describe('parseCardJson', () => {
    it('parses a V2 JSON card', () => {
      const result = parseCardJson(JSON.stringify(SAMPLE_CARD_V2_JSON))
      expect(result).not.toBeNull()
      expect(result!.card.name).toBe('TestChar')
      expect(result!.card.spec).toBe('chara_card_v2')
      expect(result!.card.specVersion).toBe('2.0')
    })

    it('parses a V3 JSON card with character_book', () => {
      const result = parseCardJson(JSON.stringify(SAMPLE_CARD_V3_WITH_BOOK))
      expect(result).not.toBeNull()
      expect(result!.card.name).toBe('WorldChar')
      expect(result!.book).not.toBeNull()
      expect(result!.book!.name).toBe('World Lore')
      expect(result!.book!.entries).toHaveLength(4)
    })

    it('returns null for non-JSON input', () => {
      expect(parseCardJson('not json at all')).toBeNull()
      expect(parseCardJson('')).toBeNull()
      expect(parseCardJson('{broken')).toBeNull()
    })

    it('returns null for Errata export JSON', () => {
      const errataExport = JSON.stringify({
        _errata: 'fragment',
        version: 1,
        source: 'test',
        exportedAt: '2024-01-01T00:00:00Z',
        fragment: { type: 'character', name: 'Test', content: 'test' },
      })
      expect(parseCardJson(errataExport)).toBeNull()
    })

    it('returns null for Errata bundle export JSON', () => {
      const bundleExport = JSON.stringify({
        _errata: 'fragment-bundle',
        version: 1,
        fragments: [],
      })
      expect(parseCardJson(bundleExport)).toBeNull()
    })

    it('returns null for random JSON without card fields', () => {
      expect(parseCardJson(JSON.stringify({ foo: 'bar' }))).toBeNull()
      expect(parseCardJson(JSON.stringify({ name: 'test' }))).toBeNull()
      expect(parseCardJson(JSON.stringify([1, 2, 3]))).toBeNull()
      expect(parseCardJson('null')).toBeNull()
      expect(parseCardJson('42')).toBeNull()
    })

    it('handles cards without character_book (items list has just the character)', () => {
      const result = parseCardJson(JSON.stringify(MINIMAL_CARD))
      expect(result).not.toBeNull()
      expect(result!.book).toBeNull()
      expect(result!.items).toHaveLength(1)
      expect(result!.items[0].source).toBe('main-character')
    })

    it('parses card data where fields are at root level (no data wrapper)', () => {
      const rootCard = {
        name: 'RootChar',
        description: 'Character at root level.',
        personality: 'Bold.',
        first_mes: '',
        scenario: '',
        system_prompt: '',
        tags: ['root'],
      }
      const result = parseCardJson(JSON.stringify(rootCard))
      expect(result).not.toBeNull()
      expect(result!.card.name).toBe('RootChar')
      expect(result!.card.tags).toEqual(['root'])
    })

    it('populates items for all present card extras', () => {
      const result = parseCardJson(JSON.stringify(SAMPLE_CARD_V2_JSON))
      expect(result).not.toBeNull()
      const sources = result!.items.map((i) => i.source)
      expect(sources).toContain('main-character')
      expect(sources).toContain('scenario')
      expect(sources).toContain('first-message')
      expect(sources).toContain('system-prompt')
    })

    it('extracts character_book entries as lorebook items', () => {
      const result = parseCardJson(JSON.stringify(SAMPLE_CARD_V3_WITH_BOOK))
      expect(result).not.toBeNull()
      const lorebookItems = result!.items.filter((i) => i.source === 'lorebook-entry')
      expect(lorebookItems).toHaveLength(4)
    })
  })

  describe('isTavernCardJson', () => {
    it('returns true for valid card JSON', () => {
      expect(isTavernCardJson(JSON.stringify(SAMPLE_CARD_V2_JSON))).toBe(true)
      expect(isTavernCardJson(JSON.stringify(SAMPLE_CARD_V3_WITH_BOOK))).toBe(true)
    })

    it('returns false for non-card JSON', () => {
      expect(isTavernCardJson('not json')).toBe(false)
      expect(isTavernCardJson(JSON.stringify({ _errata: 'fragment' }))).toBe(false)
      expect(isTavernCardJson(JSON.stringify({ foo: 'bar' }))).toBe(false)
    })
  })

  describe('inferEntryType', () => {
    it('returns guideline for constant entries', () => {
      const entry: CharacterBookEntry = {
        keys: [], secondaryKeys: [], content: 'test', comment: '', name: '',
        enabled: true, constant: true, selective: false, insertionOrder: 0,
        position: '', priority: 0, id: 1,
      }
      expect(inferEntryType(entry)).toBe('guideline')
    })

    it('returns guideline for before_char position', () => {
      const entry: CharacterBookEntry = {
        keys: [], secondaryKeys: [], content: 'test', comment: '', name: '',
        enabled: true, constant: false, selective: false, insertionOrder: 0,
        position: 'before_char', priority: 0, id: 1,
      }
      expect(inferEntryType(entry)).toBe('guideline')
    })

    it('returns knowledge for normal entries', () => {
      const entry: CharacterBookEntry = {
        keys: [], secondaryKeys: [], content: 'test', comment: '', name: '',
        enabled: true, constant: false, selective: false, insertionOrder: 0,
        position: '', priority: 0, id: 1,
      }
      expect(inferEntryType(entry)).toBe('knowledge')
    })

    it('returns knowledge for after_char position', () => {
      const entry: CharacterBookEntry = {
        keys: [], secondaryKeys: [], content: 'test', comment: '', name: '',
        enabled: true, constant: false, selective: false, insertionOrder: 0,
        position: 'after_char', priority: 0, id: 1,
      }
      expect(inferEntryType(entry)).toBe('knowledge')
    })
  })

  describe('buildImportableItems', () => {
    const makeCard = (overrides?: Partial<TavernCardData>): TavernCardData => ({
      name: 'TestChar',
      description: 'A test character.',
      personality: 'Bold.',
      firstMessage: 'Hello!',
      messageExamples: '',
      scenario: 'A test scenario.',
      creatorNotes: '',
      systemPrompt: 'Be helpful.',
      postHistoryInstructions: '',
      alternateGreetings: [],
      tags: ['test'],
      creator: 'author',
      characterVersion: '1.0',
      spec: 'chara_card_v2',
      specVersion: '2.0',
      characterBook: null,
      ...overrides,
    })

    it('always includes main character as first item', () => {
      const items = buildImportableItems(makeCard(), null)
      expect(items[0].source).toBe('main-character')
      expect(items[0].suggestedType).toBe('character')
      expect(items[0].name).toBe('TestChar')
      expect(items[0].enabled).toBe(true)
      expect(items[0].order).toBe(0)
    })

    it('includes character content from description and personality', () => {
      const items = buildImportableItems(makeCard(), null)
      const char = items[0]
      expect(char.content).toContain('A test character.')
      expect(char.content).toContain('## Personality')
      expect(char.content).toContain('Bold.')
    })

    it('includes scenario as knowledge when non-empty', () => {
      const items = buildImportableItems(makeCard(), null)
      const scenario = items.find((i) => i.source === 'scenario')
      expect(scenario).toBeDefined()
      expect(scenario!.suggestedType).toBe('knowledge')
      expect(scenario!.content).toBe('A test scenario.')
    })

    it('includes first_mes as prose when non-empty', () => {
      const items = buildImportableItems(makeCard(), null)
      const firstMsg = items.find((i) => i.source === 'first-message')
      expect(firstMsg).toBeDefined()
      expect(firstMsg!.suggestedType).toBe('prose')
      expect(firstMsg!.content).toBe('Hello!')
    })

    it('includes system_prompt as guideline with sticky and system placement', () => {
      const items = buildImportableItems(makeCard(), null)
      const sysPrompt = items.find((i) => i.source === 'system-prompt')
      expect(sysPrompt).toBeDefined()
      expect(sysPrompt!.suggestedType).toBe('guideline')
      expect(sysPrompt!.sticky).toBe(true)
      expect(sysPrompt!.placement).toBe('system')
    })

    it('omits scenario when empty', () => {
      const items = buildImportableItems(makeCard({ scenario: '' }), null)
      expect(items.find((i) => i.source === 'scenario')).toBeUndefined()
    })

    it('omits first_mes when empty', () => {
      const items = buildImportableItems(makeCard({ firstMessage: '' }), null)
      expect(items.find((i) => i.source === 'first-message')).toBeUndefined()
    })

    it('omits system_prompt when empty', () => {
      const items = buildImportableItems(makeCard({ systemPrompt: '' }), null)
      expect(items.find((i) => i.source === 'system-prompt')).toBeUndefined()
    })

    it('maps lorebook entries correctly', () => {
      const book: CharacterBook = {
        name: 'Test Book',
        entries: [
          {
            keys: ['tavern', 'inn'],
            secondaryKeys: ['drink'],
            content: 'The Golden Mug is a famous tavern.',
            comment: '',
            name: 'The Golden Mug',
            enabled: true,
            constant: false,
            selective: true,
            insertionOrder: 100,
            position: 'after_char',
            priority: 10,
            id: 1,
          },
        ],
      }
      const items = buildImportableItems(makeCard({ scenario: '', firstMessage: '', systemPrompt: '' }), book)
      const entry = items.find((i) => i.source === 'lorebook-entry')
      expect(entry).toBeDefined()
      expect(entry!.name).toBe('The Golden Mug')
      expect(entry!.suggestedType).toBe('knowledge')
      expect(entry!.tags).toEqual(['tavern', 'inn'])
      expect(entry!.content).toBe('The Golden Mug is a famous tavern.')
    })

    it('sets sticky true for constant lorebook entries', () => {
      const book: CharacterBook = {
        name: 'Test',
        entries: [
          {
            keys: ['rule'], secondaryKeys: [], content: 'Always active.', comment: '',
            name: 'Rule', enabled: true, constant: true, selective: false,
            insertionOrder: 0, position: '', priority: 0, id: 1,
          },
        ],
      }
      const items = buildImportableItems(makeCard({ scenario: '', firstMessage: '', systemPrompt: '' }), book)
      const entry = items.find((i) => i.source === 'lorebook-entry')
      expect(entry!.sticky).toBe(true)
    })

    it('sets placement to system for before_char entries', () => {
      const book: CharacterBook = {
        name: 'Test',
        entries: [
          {
            keys: ['rule'], secondaryKeys: [], content: 'Before char.', comment: '',
            name: 'Rule', enabled: true, constant: false, selective: false,
            insertionOrder: 0, position: 'before_char', priority: 0, id: 1,
          },
        ],
      }
      const items = buildImportableItems(makeCard({ scenario: '', firstMessage: '', systemPrompt: '' }), book)
      const entry = items.find((i) => i.source === 'lorebook-entry')
      expect(entry!.placement).toBe('system')
    })

    it('disabled entries have enabled: false', () => {
      const book: CharacterBook = {
        name: 'Test',
        entries: [
          {
            keys: ['old'], secondaryKeys: [], content: 'Disabled entry.', comment: '',
            name: 'Old', enabled: false, constant: false, selective: false,
            insertionOrder: 0, position: '', priority: 0, id: 1,
          },
        ],
      }
      const items = buildImportableItems(makeCard({ scenario: '', firstMessage: '', systemPrompt: '' }), book)
      const entry = items.find((i) => i.source === 'lorebook-entry')
      expect(entry!.enabled).toBe(false)
    })

    it('truncates descriptions to 250 chars', () => {
      const longContent = 'A'.repeat(300)
      const book: CharacterBook = {
        name: 'Test',
        entries: [
          {
            keys: ['long'], secondaryKeys: [], content: longContent, comment: '',
            name: 'Long', enabled: true, constant: false, selective: false,
            insertionOrder: 0, position: '', priority: 0, id: 1,
          },
        ],
      }
      const items = buildImportableItems(makeCard({ scenario: '', firstMessage: '', systemPrompt: '' }), book)
      const entry = items.find((i) => i.source === 'lorebook-entry')
      expect(entry!.description.length).toBe(250)
      expect(entry!.description.endsWith('...')).toBe(true)
    })

    it('uses keys as entry name when name and comment are empty', () => {
      const book: CharacterBook = {
        name: 'Test',
        entries: [
          {
            keys: ['alpha', 'beta', 'gamma', 'delta'], secondaryKeys: [], content: 'Test.', comment: '',
            name: '', enabled: true, constant: false, selective: false,
            insertionOrder: 0, position: '', priority: 0, id: 1,
          },
        ],
      }
      const items = buildImportableItems(makeCard({ scenario: '', firstMessage: '', systemPrompt: '' }), book)
      const entry = items.find((i) => i.source === 'lorebook-entry')
      expect(entry!.name).toBe('alpha / beta / gamma')
    })

    it('uses comment as entry name when name is empty', () => {
      const book: CharacterBook = {
        name: 'Test',
        entries: [
          {
            keys: ['test'], secondaryKeys: [], content: 'Test.', comment: 'My Comment',
            name: '', enabled: true, constant: false, selective: false,
            insertionOrder: 0, position: '', priority: 0, id: 1,
          },
        ],
      }
      const items = buildImportableItems(makeCard({ scenario: '', firstMessage: '', systemPrompt: '' }), book)
      const entry = items.find((i) => i.source === 'lorebook-entry')
      expect(entry!.name).toBe('My Comment')
    })

    it('stores lorebook meta including insertionOrder and priority', () => {
      const book: CharacterBook = {
        name: 'Test',
        entries: [
          {
            keys: ['test'], secondaryKeys: ['sec'], content: 'Test.', comment: '',
            name: 'Test', enabled: true, constant: true, selective: true,
            insertionOrder: 42, position: 'before_char', priority: 99, id: 'abc',
          },
        ],
      }
      const items = buildImportableItems(makeCard({ scenario: '', firstMessage: '', systemPrompt: '' }), book)
      const entry = items.find((i) => i.source === 'lorebook-entry')
      expect(entry!.meta).toMatchObject({
        importSource: 'tavern-card',
        lorebookEntryId: 'abc',
        insertionOrder: 42,
        priority: 99,
        selective: true,
        constant: true,
        position: 'before_char',
        secondaryKeys: ['sec'],
      })
    })

    it('assigns sequential order values', () => {
      const result = parseCardJson(JSON.stringify(SAMPLE_CARD_V3_WITH_BOOK))
      expect(result).not.toBeNull()
      const orders = result!.items.map((i) => i.order)
      for (let i = 0; i < orders.length; i++) {
        expect(orders[i]).toBe(i)
      }
    })

    it('character tags come from card tags', () => {
      const items = buildImportableItems(makeCard({ tags: ['hero', 'brave'] }), null)
      expect(items[0].tags).toEqual(['hero', 'brave'])
    })
  })
})
