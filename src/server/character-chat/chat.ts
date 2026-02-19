import { getModel } from '../llm/client'
import { getFragment, getStory } from '../fragments/storage'
import { buildContextState } from '../llm/context-builder'
import { createFragmentTools } from '../llm/tools'
import { createLogger } from '../logging'
import { createCharacterChatAgent } from './llm-agents'
import { withBranch } from '../fragments/branches'
import type { PersonaMode } from './storage'
import type { ChatStreamEvent, ChatResult } from '../librarian/chat'

const logger = createLogger('character-chat')

export { type ChatStreamEvent, type ChatResult }

function buildPersonaDescription(persona: PersonaMode, personaCharacterName?: string, personaCharacterDescription?: string): string {
  switch (persona.type) {
    case 'character':
      return `You are speaking with ${personaCharacterName ?? 'another character'}. ${personaCharacterDescription ?? ''}`
    case 'stranger':
      return 'You are speaking with a stranger you have just met. You do not know who they are.'
    case 'custom':
      return `You are speaking with someone described as: ${persona.prompt}`
  }
}

function buildSystemPrompt(
  characterName: string,
  characterDescription: string,
  characterContent: string,
  personaDescription: string,
  storyContext: string,
): string {
  return `You are roleplaying as ${characterName}. Stay in character at all times.

## Character Details
${characterContent}

## Character Description
${characterDescription}

## Story Context
${storyContext}

## Who You Are Speaking With
${personaDescription}

## Instructions
1. Respond as ${characterName} would, using their voice, mannerisms, and knowledge.
2. You only know events up to the selected story point. Do not reference future events.
3. You may use tools to look up fragment details when needed, but do NOT mention your use of tools in conversation.
4. If asked about events beyond your knowledge cutoff, respond with genuine uncertainty — the character does not know.
5. Stay in character. Do not break the fourth wall unless the character would.
6. Keep responses natural and conversational.`
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

  // Build context state limited to the story point
  const ctxState = await buildContextState(dataDir, storyId, '', {
    proseBeforeFragmentId: opts.storyPointFragmentId ?? undefined,
    summaryBeforeFragmentId: opts.storyPointFragmentId ?? undefined,
  })

  // Build context string
  const contextParts: string[] = []
  contextParts.push(`## Story: ${story.name}`)
  contextParts.push(story.description)
  if (story.summary) {
    contextParts.push(`\n## Story Summary\n${story.summary}`)
  }

  // Prose summaries
  if (ctxState.proseFragments.length > 0) {
    contextParts.push('\n## Story Events (use getFragment to read full prose)')
    for (const p of ctxState.proseFragments) {
      if ((p.meta._librarian as { summary?: string })?.summary) {
        contextParts.push(`- ${p.id}: ${(p.meta._librarian as { summary?: string }).summary}`)
      } else if (p.content.length < 600) {
        contextParts.push(`- ${p.id}: \n${p.content}`)
      } else {
        contextParts.push(`- ${p.id}: ${p.content.slice(0, 500).replace(/\n/g, ' ')}... [truncated]`)
      }
    }
  }

  // Sticky fragments
  const stickyAll = [
    ...ctxState.stickyGuidelines,
    ...ctxState.stickyKnowledge,
    ...ctxState.stickyCharacters,
  ]
  if (stickyAll.length > 0) {
    contextParts.push('\n## World Context')
    for (const f of stickyAll) {
      contextParts.push(`- ${f.id}: ${f.name} — ${f.description}`)
    }
  }

  // Shortlist
  const shortlistAll = [
    ...ctxState.guidelineShortlist,
    ...ctxState.knowledgeShortlist,
    ...ctxState.characterShortlist,
  ]
  if (shortlistAll.length > 0) {
    contextParts.push('\n## Other Available Fragments')
    for (const f of shortlistAll) {
      contextParts.push(`- ${f.id}: ${f.name} — ${f.description}`)
    }
  }

  const storyContext = contextParts.join('\n')
  const personaDescription = buildPersonaDescription(opts.persona, personaCharacterName, personaCharacterDescription)

  const systemPrompt = buildSystemPrompt(
    character.name,
    character.description,
    character.content,
    personaDescription,
    storyContext,
  )

  // Read-only fragment tools
  const tools = createFragmentTools(dataDir, storyId, { readOnly: true })

  requestLogger.info('Prepared character chat tools', {
    toolCount: Object.keys(tools).length,
  })

  // Resolve model
  const { model, modelId } = await getModel(dataDir, storyId, { role: 'characterChat' })
  requestLogger.info('Resolved model', { modelId })

  const chatAgent = createCharacterChatAgent({
    model,
    instructions: systemPrompt,
    tools,
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
  const fullStream = result.fullStream

  let completionResolve: (val: { text: string; reasoning: string; toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>; stepCount: number; finishReason: string }) => void
  let completionReject: (err: unknown) => void
  const completion = new Promise<{
    text: string
    reasoning: string
    toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>
    stepCount: number
    finishReason: string
  }>((resolve, reject) => {
    completionResolve = resolve
    completionReject = reject
  })

  let fullText = ''
  let fullReasoning = ''
  const toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }> = []
  let lastFinishReason = 'unknown'
  let stepCount = 0

  const eventStream = new ReadableStream<string>({
    async start(controller) {
      try {
        for await (const part of fullStream) {
          let event: ChatStreamEvent | null = null
          const p = part as Record<string, unknown>

          switch (part.type) {
            case 'text-delta': {
              const text = (p.text ?? '') as string
              fullText += text
              event = { type: 'text', text }
              break
            }
            case 'reasoning-delta': {
              const text = (p.text ?? '') as string
              fullReasoning += text
              event = { type: 'reasoning', text }
              break
            }
            case 'tool-call': {
              const input = (p.input ?? {}) as Record<string, unknown>
              event = {
                type: 'tool-call',
                id: p.toolCallId as string,
                toolName: p.toolName as string,
                args: input,
              }
              break
            }
            case 'tool-result': {
              const toolCallId = p.toolCallId as string
              const toolName = (p.toolName as string) ?? ''
              toolCalls.push({ toolName, args: {}, result: p.output })
              event = {
                type: 'tool-result',
                id: toolCallId,
                toolName,
                result: p.output,
              }
              break
            }
            case 'finish':
              lastFinishReason = (p.finishReason as string) ?? 'unknown'
              stepCount++
              break
          }

          if (event) {
            controller.enqueue(JSON.stringify(event) + '\n')
          }
        }

        const finishEvent: ChatStreamEvent = {
          type: 'finish',
          finishReason: lastFinishReason,
          stepCount,
        }
        controller.enqueue(JSON.stringify(finishEvent) + '\n')
        controller.close()

        completionResolve!({
          text: fullText,
          reasoning: fullReasoning,
          toolCalls,
          stepCount,
          finishReason: lastFinishReason,
        })
      } catch (err) {
        controller.error(err)
        completionReject!(err)
      }
    },
  })

  return { eventStream, completion }
}
