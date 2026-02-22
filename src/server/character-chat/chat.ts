import { getFragment } from '../fragments/storage'
import { instructionRegistry } from '../instructions'
import { createStreamingRunner } from '../agents/create-streaming-runner'
import type { Fragment } from '../fragments/schema'
import type { PersonaMode } from './storage'
import type { ChatStreamEvent, ChatResult } from '../agents/stream-types'

export { type ChatStreamEvent, type ChatResult }

function buildPersonaDescription(persona: PersonaMode, personaCharacterName?: string, personaCharacterDescription?: string, modelId?: string): string {
  switch (persona.type) {
    case 'character': {
      const template = instructionRegistry.resolve('character-chat.persona.character', modelId)
      return template
        .replace(/\{\{personaName\}\}/g, personaCharacterName ?? 'another character')
        .replace(/\{\{personaDescription\}\}/g, personaCharacterDescription ?? '')
    }
    case 'stranger':
      return instructionRegistry.resolve('character-chat.persona.stranger', modelId)
    case 'custom': {
      const template = instructionRegistry.resolve('character-chat.persona.custom', modelId)
      return template.replace(/\{\{prompt\}\}/g, persona.prompt)
    }
  }
}

export interface CharacterChatOptions {
  characterId: string
  persona: PersonaMode
  storyPointFragmentId: string | null
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxSteps?: number
}

export const characterChat = createStreamingRunner<CharacterChatOptions, { character: Fragment; personaCharacterName?: string; personaCharacterDescription?: string }>({
  name: 'character-chat.chat',
  role: 'character-chat.chat',
  readOnly: true,

  validate: async ({ dataDir, storyId, opts }) => {
    const character = await getFragment(dataDir, storyId, opts.characterId)
    if (!character || character.type !== 'character') {
      throw new Error(`Character ${opts.characterId} not found`)
    }

    // Load persona character if applicable
    let personaCharacterName: string | undefined
    let personaCharacterDescription: string | undefined
    if (opts.persona.type === 'character') {
      const personaChar = await getFragment(dataDir, storyId, opts.persona.characterId)
      if (personaChar) {
        personaCharacterName = personaChar.name
        personaCharacterDescription = personaChar.description
      }
    }

    return { character, personaCharacterName, personaCharacterDescription }
  },

  contextOptions: (opts) => ({
    proseBeforeFragmentId: opts.storyPointFragmentId ?? undefined,
    summaryBeforeFragmentId: opts.storyPointFragmentId ?? undefined,
  }),

  extraContext: async ({ opts, validated, modelId }) => ({
    character: validated.character,
    personaDescription: buildPersonaDescription(
      opts.persona,
      validated.personaCharacterName,
      validated.personaCharacterDescription,
      modelId,
    ),
  }),

  messages: ({ opts }) =>
    opts.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
})
