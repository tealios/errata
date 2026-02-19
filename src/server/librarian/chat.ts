import { tool } from 'ai'
import { z } from 'zod/v4'
import { getModel } from '../llm/client'
import { getFragment, getStory } from '../fragments/storage'
import { buildContextState } from '../llm/context-builder'
import { createFragmentTools } from '../llm/tools'
import { pluginRegistry } from '../plugins/registry'
import { collectPluginTools } from '../plugins/tools'
import { createLogger } from '../logging'
import { createLibrarianChatAgent } from './llm-agents'
import { getFragmentsByTag } from '../fragments/associations'
import { runLibrarian } from './agent'
import { withBranch } from '../fragments/branches'

const logger = createLogger('librarian-chat')

const CHAT_SYSTEM_PROMPT = `
You are a conversational librarian assistant for a collaborative writing app. Your job is to help the author maintain story continuity by answering questions and performing fragment edits through tools.
Important: Follow the agent configuration.

Your tools:
- getFragment(id) — Read any fragment's full content. Use this to read prose before editing.
- editProse(oldText, newText) — Search and replace across active prose in the story chain. You must read the prose with getFragment first to know the exact text.
- editFragment(fragmentId, oldText, newText) — Search and replace within a specific non-prose fragment.
- updateFragment(fragmentId, newContent, newDescription) — Overwrite a fragment's entire content.
- createFragment(type, name, description, content) — Create a brand-new fragment.
- listFragments(type?) — List fragments, optionally by type.
- searchFragments(query, type?) — Search for text across all fragments.
- deleteFragment(fragmentId) — Delete a fragment.
- getStorySummary() — Read the current rolling story summary.
- updateStorySummary(summary) — Replace the story's rolling summary with a new version. Use this to rewrite, condense, or correct the summary based on all available prose.
- reanalyzeFragment(fragmentId) — Re-run librarian analysis on a prose fragment. Updates the fragment's summary, detects mentions, flags contradictions, and suggests knowledge. Use when the author asks to re-examine or reanalyze a specific prose section.

Instructions:
1. Your context includes a story summary and fragment summaries (IDs, names, descriptions) — not full content. Use getFragment(id) to read the full content of any fragment you need.
2. For prose edits, first read the relevant prose fragment with getFragment, then use editProse(oldText, newText) — it scans active prose automatically.
3. For character/guideline/knowledge changes, use editFragment or updateFragment with the fragment ID.
3b. When the author asks to add new lore/character/rules, use createFragment.
4. When the author asks for sweeping changes (e.g. "update all characters to reflect the time skip"), use listFragments and getFragment to find relevant fragments, then update each one.
5. Explain what you changed and why after making edits.
6. Ask clarifying questions when the request is ambiguous.
7. You can make multiple tool calls in sequence to accomplish complex tasks.
8. Keep fragment descriptions within the 250 character limit.
9. Be concise but thorough in your responses.

Fragment ID prefixes: pr- (prose), ch- (character), gl- (guideline), kn- (knowledge).
`

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
  return withBranch(dataDir, storyId, () => librarianChatInner(dataDir, storyId, opts))
}

async function librarianChatInner(
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

  // Include prose fragment summaries (use getFragment to read full content)
  if (ctxState.proseFragments.length > 0) {
    contextParts.push('\n## Prose Fragments (use getFragment to read/edit)')
    for (const p of ctxState.proseFragments) {
      if ((p.meta._librarian as { summary?: string })?.summary) {
        contextParts.push(`- ${p.id}: ${(p.meta._librarian as { summary?: string }).summary ?? 'No summary available'}`)
      }
      else if (p.content.length < 600) {
        contextParts.push(`- ${p.id}: \n${p.content}`)
      } else {
        contextParts.push(`- ${p.id}: ${p.content.slice(0, 500).replace(/\n/g, ' ')}... [truncated]`)
      }
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

  const reanalyzeFragmentTool = tool({
    description: 'Re-run librarian analysis on a prose fragment. Updates its summary, detects mentions, flags contradictions, and suggests knowledge.',
    inputSchema: z.object({
      fragmentId: z.string().describe('The prose fragment ID to reanalyze (e.g. pr-bakumo)'),
    }),
    execute: async ({ fragmentId }: { fragmentId: string }) => {
      requestLogger.info('Reanalyzing fragment via chat tool', { fragmentId })
      try {
        const analysis = await runLibrarian(dataDir, storyId, fragmentId)
        return {
          ok: true,
          analysisId: analysis.id,
          summary: analysis.summaryUpdate,
          mentionCount: analysis.mentionedCharacters.length,
          contradictionCount: analysis.contradictions.length,
          suggestionCount: analysis.knowledgeSuggestions.length,
          timelineEventCount: analysis.timelineEvents.length,
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const tools = { ...fragmentTools, ...pluginTools, reanalyzeFragment: reanalyzeFragmentTool }

  const pluginToolLines = Object.entries(pluginTools)
    .map(([name, def]) => {
      const description = (def as { description?: string }).description ?? ''
      return `- ${name}${description ? ` — ${description}` : ''}`
    })
  let chatSystemPrompt = pluginToolLines.length > 0
    ? `${CHAT_SYSTEM_PROMPT}\n\nAdditional enabled plugin tools:\n${pluginToolLines.join('\n')}`
    : CHAT_SYSTEM_PROMPT

  let sysFragIds = await getFragmentsByTag(dataDir, storyId, 'pass-to-librarian-system-prompt')
  let sysFrags = []
  for (const id of sysFragIds) {
    const frag = await getFragment(dataDir, storyId, id)
    if (frag) {
      requestLogger.debug('Adding system prompt fragment to context', { fragmentId: frag.id, name: frag.name })
      sysFrags.push(frag)
    }
  }
  chatSystemPrompt += '\n' + sysFrags.map(f => `- ${f.id}: ${f.name} — ${f.content}`).join('\n')

  requestLogger.info('Prepared chat tools', {
    fragmentToolCount: Object.keys(fragmentTools).length,
    pluginToolCount: Object.keys(pluginTools).length,
    totalToolCount: Object.keys(tools).length,
  })

  // Resolve model
  const { model, modelId } = await getModel(dataDir, storyId, { role: 'librarianChat' })
  requestLogger.info('Resolved model', { modelId })

  const chatAgent = createLibrarianChatAgent({
    model,
    instructions: chatSystemPrompt,
    tools,
    maxSteps: opts.maxSteps ?? 10,
  })

  // Stream with write tools
  const result = await chatAgent.stream({
    messages: aiMessages,
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
