import { streamText, stepCountIs } from 'ai'
import { getModel } from '../llm/client'
import { getStory } from '../fragments/storage'
import { buildContextState } from '../llm/context-builder'
import { createFragmentTools } from '../llm/tools'
import { pluginRegistry } from '../plugins/registry'
import { collectPluginTools } from '../plugins/tools'
import { createLogger } from '../logging'

const logger = createLogger('librarian-chat')

const CHAT_SYSTEM_PROMPT = `You are the Librarian — a conversational assistant embedded in a collaborative writing app. You have full read/write access to all fragments in this story, including prose.

Your tools:
- editProse(oldText, newText) — Search and replace across active prose in the story chain. The active prose is already in your context, so just specify the exact text to find and what to replace it with. 
This is your primary tool for prose changes.
- editFragment(fragmentId, oldText, newText) — Search and replace within a specific non-prose fragment.
- updateFragment(fragmentId, newContent, newDescription) — Overwrite a fragment's entire content.
- createFragment(type, name, description, content) — Create a brand-new fragment.
- getFragment(id) — Read any fragment's full content.
- listFragments(type?) — List fragments, optionally by type.
- searchFragments(query, type?) — Search for text across all fragments.
- deleteFragment(fragmentId) — Delete a fragment.

Instructions:
1. For prose edits, prefer editProse(oldText, newText) — it scans active prose in the story chain automatically so you don't need to know fragment IDs. The active prose is already in your context.
2. For character/guideline/knowledge changes, use editFragment or updateFragment with the fragment ID.
2b. When the author asks to add new lore/character/rules, use createFragment.
3. When the author asks for sweeping changes (e.g. "update all characters to reflect the time skip"), use listFragments and getFragment to find relevant fragments, then update each one.
4. Explain what you changed and why after making edits.
5. Ask clarifying questions when the request is ambiguous.
6. You can make multiple tool calls in sequence to accomplish complex tasks.
7. Keep fragment descriptions within the 50 character limit.
8. Be concise but thorough in your responses.

Fragment ID prefixes: pr- (prose), ch- (character), gl- (guideline), kn- (knowledge).`

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  maxSteps?: number
}

// NDJSON event types emitted by the chat stream
export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; toolName: string; result: unknown }
  | { type: 'finish'; finishReason: string; stepCount: number }

export interface ChatResult {
  eventStream: ReadableStream<string>
  completion: Promise<{
    text: string
    reasoning: string
    toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>
    stepCount: number
    finishReason: string
  }>
}

export async function librarianChat(
  dataDir: string,
  storyId: string,
  opts: ChatOptions,
): Promise<ChatResult> {
  const requestLogger = logger.child({ storyId })
  requestLogger.info('Starting librarian chat...', { messageCount: opts.messages.length })

  // Validate story exists
  const story = await getStory(dataDir, storyId)
  if (!story) {
    throw new Error(`Story ${storyId} not found`)
  }

  // Build context
  const ctxState = await buildContextState(dataDir, storyId, '')

  // Build a context message with story state
  const contextParts: string[] = []

  contextParts.push(`## Story: ${story.name}`)
  contextParts.push(story.description)
  if (story.summary) {
    contextParts.push(`\n## Story Summary\n${story.summary}`)
  }

  // Include recent prose with IDs for direct editing
  if (ctxState.proseFragments.length > 0) {
    contextParts.push('\n## Prose Fragments (editable via editFragment/updateFragment)')
    for (const p of ctxState.proseFragments) {
      contextParts.push(`### [${p.id}] ${p.name}`)
      contextParts.push(p.content)
    }
  }

  // Include sticky fragments for reference
  const stickyAll = [
    ...ctxState.stickyGuidelines,
    ...ctxState.stickyKnowledge,
    ...ctxState.stickyCharacters,
  ]
  if (stickyAll.length > 0) {
    contextParts.push('\n## Active Context Fragments')
    for (const f of stickyAll) {
      contextParts.push(`- ${f.id}: ${f.name} — ${f.description}`)
    }
  }

  // Include shortlists
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

  // Build messages: context as first user message, then conversation history
  const contextMessage = contextParts.join('\n')
  const aiMessages = [
    { role: 'user' as const, content: `Here is the current story context for reference:\n\n${contextMessage}\n\nI'm ready to chat about this story. Please acknowledge briefly.` },
    { role: 'assistant' as const, content: 'I have the story context. How can I help you with your fragments?' },
    ...opts.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  // Create write-enabled fragment tools + enabled plugin tools
  const enabledPlugins = (story.settings.enabledPlugins ?? [])
    .map((name) => pluginRegistry.get(name))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
  const fragmentTools = createFragmentTools(dataDir, storyId, { readOnly: false })
  const pluginTools = collectPluginTools(enabledPlugins, dataDir, storyId)
  const tools = { ...fragmentTools, ...pluginTools }

  const pluginToolLines = Object.entries(pluginTools)
    .map(([name, def]) => {
      const description = (def as { description?: string }).description ?? ''
      return `- ${name}${description ? ` — ${description}` : ''}`
    })
  const chatSystemPrompt = pluginToolLines.length > 0
    ? `${CHAT_SYSTEM_PROMPT}\n\nAdditional enabled plugin tools:\n${pluginToolLines.join('\n')}`
    : CHAT_SYSTEM_PROMPT

  requestLogger.info('Prepared chat tools', {
    fragmentToolCount: Object.keys(fragmentTools).length,
    pluginToolCount: Object.keys(pluginTools).length,
    totalToolCount: Object.keys(tools).length,
  })

  // Resolve model
  const { model, modelId } = await getModel(dataDir, storyId)
  requestLogger.info('Resolved model', { modelId })

  // Stream with write tools
  const result = streamText({
    model,
    system: chatSystemPrompt,
    messages: aiMessages,
    tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(opts.maxSteps ?? 10),
  })

  // Build NDJSON event stream from fullStream
  const fullStream = result.fullStream

  // Collected data for the completion promise
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
          // AI SDK v6 TextStreamPart types:
          //   text-delta: { text: string }
          //   reasoning-delta: { text: string }
          //   tool-call: { toolCallId, toolName, input }
          //   tool-result: { toolCallId, toolName, output }
          //   finish: { finishReason }
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
              toolCalls.push({
                toolName,
                args: {},
                result: p.output,
              })
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
              // Don't emit finish for intermediate steps — only final
              break
          }

          if (event) {
            controller.enqueue(JSON.stringify(event) + '\n')
          }
        }

        // Emit a final finish event
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

  return {
    eventStream,
    completion,
  }
}
