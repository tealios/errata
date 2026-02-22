import { getModel } from '../llm/client'
import { getFragment, getStory } from '../fragments/storage'
import { buildContextState } from '../llm/context-builder'
import { createFragmentTools } from '../llm/tools'
import { instructionRegistry } from '../instructions'
import { createLogger } from '../logging'
import { createToolAgent } from '../agents/create-agent'
import { createEventStream } from '../agents/create-event-stream'
import { compileAgentContext } from '../agents/compile-agent-context'
import { withBranch } from '../fragments/branches'
import type { PersonaMode } from './storage'
import type { ChatStreamEvent, ChatResult } from '../agents/stream-types'
import type { AgentBlockContext } from '../agents/agent-block-context'

const logger = createLogger('character-chat')

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

export async function characterChat(
  dataDir: string,
  storyId: string,
  opts: CharacterChatOptions,
): Promise<ChatResult> {
  return withBranch(dataDir, storyId, () => characterChatInner(dataDir, storyId, opts))
}

async function characterChatInner(
  dataDir: string,
  storyId: string,
  opts: CharacterChatOptions,
): Promise<ChatResult> {
  const requestLogger = logger.child({ storyId })
  requestLogger.info('Starting character chat...', {
    characterId: opts.characterId,
    personaType: opts.persona.type,
    messageCount: opts.messages.length,
  })

  const story = await getStory(dataDir, storyId)
  if (!story) throw new Error(`Story ${storyId} not found`)

  // Load target character
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

  // Resolve model early so modelId is available for instruction resolution
  const { model, modelId } = await getModel(dataDir, storyId, { role: 'character-chat.chat' })
  requestLogger.info('Resolved model', { modelId })

  // Build context state limited to the story point
  const ctxState = await buildContextState(dataDir, storyId, '', {
    proseBeforeFragmentId: opts.storyPointFragmentId ?? undefined,
    summaryBeforeFragmentId: opts.storyPointFragmentId ?? undefined,
  })

  const personaDescription = buildPersonaDescription(opts.persona, personaCharacterName, personaCharacterDescription, modelId)

  // Build agent block context
  const blockContext: AgentBlockContext = {
    story: ctxState.story,
    proseFragments: ctxState.proseFragments,
    stickyGuidelines: ctxState.stickyGuidelines,
    stickyKnowledge: ctxState.stickyKnowledge,
    stickyCharacters: ctxState.stickyCharacters,
    guidelineShortlist: ctxState.guidelineShortlist,
    knowledgeShortlist: ctxState.knowledgeShortlist,
    characterShortlist: ctxState.characterShortlist,
    systemPromptFragments: [],
    character,
    personaDescription,
    modelId,
  }

  // Read-only fragment tools
  const allTools = createFragmentTools(dataDir, storyId, { readOnly: true })

  // Compile context via block system
  const compiled = await compileAgentContext(dataDir, storyId, 'character-chat.chat', blockContext, allTools)

  requestLogger.info('Prepared character chat tools', {
    toolCount: Object.keys(compiled.tools).length,
  })

  // Extract system instructions from compiled messages
  const systemMessage = compiled.messages.find(m => m.role === 'system')

  const chatAgent = createToolAgent({
    model,
    instructions: systemMessage?.content ?? '',
    tools: compiled.tools,
    maxSteps: opts.maxSteps ?? 5,
  })

  // Build messages
  const aiMessages = [
    ...opts.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  // Stream
  const result = await chatAgent.stream({ messages: aiMessages })

  return createEventStream(result.fullStream)
}
