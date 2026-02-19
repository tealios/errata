import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'
import {
  saveConversation,
  getConversation,
  listConversations,
  deleteConversation,
  generateConversationId,
  type CharacterChatConversation,
  type PersonaMode,
} from '@/server/character-chat/storage'

function makeConversation(overrides: Partial<CharacterChatConversation> = {}): CharacterChatConversation {
  return {
    id: generateConversationId(),
    characterId: 'ch-hero',
    persona: { type: 'stranger' },
    storyPointFragmentId: null,
    title: 'Test Conversation',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('character-chat storage', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-cc-test'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await createStory(dataDir, {
      id: storyId,
      name: 'Test Story',
      description: 'For character chat tests',
      summary: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: makeTestSettings(),
    })
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('conversation CRUD', () => {
    it('saves and loads a conversation round-trip', async () => {
      const conv = makeConversation({ id: 'cc-roundtrip' })
      await saveConversation(dataDir, storyId, conv)

      const loaded = await getConversation(dataDir, storyId, 'cc-roundtrip')
      expect(loaded).toEqual(conv)
    })

    it('returns null for non-existent conversation', async () => {
      const loaded = await getConversation(dataDir, storyId, 'cc-nonexistent')
      expect(loaded).toBeNull()
    })

    it('saves conversation with messages', async () => {
      const conv = makeConversation({
        id: 'cc-with-msgs',
        messages: [
          { role: 'user', content: 'Hello there', createdAt: '2025-01-01T00:00:00.000Z' },
          { role: 'assistant', content: 'Greetings, traveler.', reasoning: 'The character is formal.', createdAt: '2025-01-01T00:00:01.000Z' },
        ],
      })
      await saveConversation(dataDir, storyId, conv)

      const loaded = await getConversation(dataDir, storyId, 'cc-with-msgs')
      expect(loaded!.messages).toHaveLength(2)
      expect(loaded!.messages[0].content).toBe('Hello there')
      expect(loaded!.messages[1].reasoning).toBe('The character is formal.')
    })

    it('overwrites existing conversation on save', async () => {
      const conv = makeConversation({ id: 'cc-overwrite', title: 'First' })
      await saveConversation(dataDir, storyId, conv)

      const updated = { ...conv, title: 'Updated', updatedAt: new Date().toISOString() }
      await saveConversation(dataDir, storyId, updated)

      const loaded = await getConversation(dataDir, storyId, 'cc-overwrite')
      expect(loaded!.title).toBe('Updated')
    })

    it('preserves all persona modes', async () => {
      const personas: PersonaMode[] = [
        { type: 'stranger' },
        { type: 'character', characterId: 'ch-villain' },
        { type: 'custom', prompt: 'A traveling merchant' },
      ]

      for (const [i, persona] of personas.entries()) {
        const conv = makeConversation({ id: `cc-persona-${i}`, persona })
        await saveConversation(dataDir, storyId, conv)

        const loaded = await getConversation(dataDir, storyId, `cc-persona-${i}`)
        expect(loaded!.persona).toEqual(persona)
      }
    })
  })

  describe('list conversations', () => {
    it('lists conversations sorted by updatedAt descending', async () => {
      await saveConversation(dataDir, storyId, makeConversation({
        id: 'cc-old',
        updatedAt: '2025-01-01T00:00:00.000Z',
      }))
      await saveConversation(dataDir, storyId, makeConversation({
        id: 'cc-new',
        updatedAt: '2025-01-02T00:00:00.000Z',
      }))

      const list = await listConversations(dataDir, storyId)
      expect(list).toHaveLength(2)
      expect(list[0].id).toBe('cc-new')
      expect(list[1].id).toBe('cc-old')
    })

    it('returns summaries with message count', async () => {
      await saveConversation(dataDir, storyId, makeConversation({
        id: 'cc-counted',
        messages: [
          { role: 'user', content: 'Hi', createdAt: new Date().toISOString() },
          { role: 'assistant', content: 'Hello', createdAt: new Date().toISOString() },
          { role: 'user', content: 'Bye', createdAt: new Date().toISOString() },
        ],
      }))

      const list = await listConversations(dataDir, storyId)
      expect(list[0].messageCount).toBe(3)
    })

    it('filters by characterId', async () => {
      await saveConversation(dataDir, storyId, makeConversation({
        id: 'cc-hero',
        characterId: 'ch-hero',
      }))
      await saveConversation(dataDir, storyId, makeConversation({
        id: 'cc-villain',
        characterId: 'ch-villain',
      }))

      const heroOnly = await listConversations(dataDir, storyId, 'ch-hero')
      expect(heroOnly).toHaveLength(1)
      expect(heroOnly[0].characterId).toBe('ch-hero')
    })

    it('returns empty list when no conversations exist', async () => {
      const list = await listConversations(dataDir, storyId)
      expect(list).toEqual([])
    })
  })

  describe('delete conversation', () => {
    it('deletes an existing conversation', async () => {
      await saveConversation(dataDir, storyId, makeConversation({ id: 'cc-delete-me' }))
      const deleted = await deleteConversation(dataDir, storyId, 'cc-delete-me')
      expect(deleted).toBe(true)

      const loaded = await getConversation(dataDir, storyId, 'cc-delete-me')
      expect(loaded).toBeNull()
    })

    it('returns false for non-existent conversation', async () => {
      const deleted = await deleteConversation(dataDir, storyId, 'cc-nonexistent')
      expect(deleted).toBe(false)
    })

    it('does not affect other conversations', async () => {
      await saveConversation(dataDir, storyId, makeConversation({ id: 'cc-keep' }))
      await saveConversation(dataDir, storyId, makeConversation({ id: 'cc-remove' }))

      await deleteConversation(dataDir, storyId, 'cc-remove')

      const kept = await getConversation(dataDir, storyId, 'cc-keep')
      expect(kept).not.toBeNull()

      const removed = await getConversation(dataDir, storyId, 'cc-remove')
      expect(removed).toBeNull()
    })
  })

  describe('generateConversationId', () => {
    it('generates unique IDs with cc- prefix', () => {
      const id1 = generateConversationId()
      const id2 = generateConversationId()
      expect(id1).toMatch(/^cc-/)
      expect(id2).toMatch(/^cc-/)
      expect(id1).not.toBe(id2)
    })
  })
})
