/**
 * Factory for standard streaming agent runners.
 *
 * Encodes the 14-step validate → resolve → build → compile → stream pipeline
 * that all streaming agents share. Only the agent-specific "knobs" vary.
 */

import type { ToolSet } from 'ai'
import type { StoryMeta } from '../fragments/schema'
import type { ContextBuildState } from '../llm/context-builder'
import type { AgentBlockContext } from './agent-block-context'
import type { AgentStreamResult } from './stream-types'
import { getModel } from '../llm/client'
import { getStory } from '../fragments/storage'
import { buildContextState } from '../llm/context-builder'
import { createFragmentTools } from '../llm/tools'
import { reportUsage } from '../llm/token-tracker'
import { createLogger } from '../logging'
import { createToolAgent } from './create-agent'
import { createEventStream } from './create-event-stream'
import { compileAgentContext, type CompiledAgentContext } from './compile-agent-context'
import { withBranch } from '../fragments/branches'

export interface StreamingRunnerConfig<TOpts, TValidated = Record<string, unknown>> {
  /** Agent name — used for logging, model role, and block compilation. */
  name: string

  /** Model role key (defaults to `name`). */
  role?: string

  /** Default maxSteps when opts doesn't specify one. Default: 5 */
  maxSteps?: number

  /** Tool choice passed to the agent. Default: 'auto' */
  toolChoice?: 'auto' | 'none'

  /**
   * Whether to call buildContextState. Default: true.
   * Set to false for agents that don't need story context (e.g. prose-transform).
   */
  buildContext?: boolean

  /**
   * Validate inputs before running. Return value is passed to later hooks.
   * Throw to abort with an error.
   */
  validate?: (params: {
    dataDir: string
    storyId: string
    opts: TOpts
    story: StoryMeta
  }) => Promise<TValidated>

  /** Options passed to buildContextState. Return {} or omit for defaults. */
  contextOptions?: (opts: TOpts) => Record<string, unknown>

  /**
   * Extra fields merged into the AgentBlockContext beyond the standard ctxState spread.
   * This is where agent-specific context (targetFragment, character, etc.) is provided.
   */
  extraContext?: (params: {
    dataDir: string
    storyId: string
    opts: TOpts
    ctxState: ContextBuildState | null
    story: StoryMeta
    validated: TValidated
    modelId: string
  }) => Promise<Partial<AgentBlockContext>> | Partial<AgentBlockContext>

  /**
   * Provide tools for the agent. Gets the default fragment tools (unless overridden).
   *
   * - Return the tools the agent should use.
   * - `fragmentTools` is pre-built based on `readOnly`.
   * - For agents with no tools, set `readOnly: 'none'` and return {}.
   */
  readOnly?: boolean | 'none'
  tools?: (params: {
    dataDir: string
    storyId: string
    opts: TOpts
    story: StoryMeta
    fragmentTools: ToolSet
  }) => ToolSet

  /**
   * Build the messages array passed to agent.stream().
   * Default: single user message from compiled context.
   */
  messages?: (params: {
    compiled: CompiledAgentContext
    opts: TOpts
  }) => Array<{ role: 'user' | 'assistant'; content: string }>

  /**
   * Optional post-stream hook. Called with the stream result after creation.
   * Use for logging, background cleanup, etc.
   */
  afterStream?: (result: AgentStreamResult) => void
}

/**
 * Create a streaming agent runner function from a config object.
 *
 * Returns `(dataDir, storyId, opts) => Promise<AgentStreamResult>` that
 * wraps the full validate → resolve → build → compile → stream pipeline.
 */
export function createStreamingRunner<TOpts extends object, TValidated = Record<string, unknown>>(
  config: StreamingRunnerConfig<TOpts, TValidated>,
): (dataDir: string, storyId: string, opts: TOpts) => Promise<AgentStreamResult> {
  const logger = createLogger(config.name)
  const role = config.role ?? config.name
  const defaultMaxSteps = config.maxSteps ?? 10
  const shouldBuildContext = config.buildContext !== false

  return async function run(dataDir: string, storyId: string, opts: TOpts): Promise<AgentStreamResult> {
    return withBranch(dataDir, storyId, async () => {
      const requestLogger = logger.child({ storyId })
      requestLogger.info(`Starting ${config.name}...`)

      // 1. Validate story
      const story = await getStory(dataDir, storyId)
      if (!story) throw new Error(`Story ${storyId} not found`)

      // 2. Agent-specific validation
      const validated = config.validate
        ? await config.validate({ dataDir, storyId, opts, story })
        : ({} as TValidated)

      // 3. Resolve model early (modelId needed for instruction resolution)
      const { model, modelId } = await getModel(dataDir, storyId, { role })
      requestLogger.info('Resolved model', { modelId })

      // 4. Build story context (optional)
      let ctxState: ContextBuildState | null = null
      if (shouldBuildContext) {
        const ctxOpts = config.contextOptions?.(opts) ?? {}
        ctxState = await buildContextState(dataDir, storyId, '', ctxOpts)
      }

      // 5. Assemble AgentBlockContext
      const extra = config.extraContext
        ? await config.extraContext({ dataDir, storyId, opts, ctxState, story, validated, modelId })
        : {}

      const blockContext: AgentBlockContext = {
        story: ctxState?.story ?? story,
        proseFragments: ctxState?.proseFragments ?? [],
        stickyGuidelines: ctxState?.stickyGuidelines ?? [],
        stickyKnowledge: ctxState?.stickyKnowledge ?? [],
        stickyCharacters: ctxState?.stickyCharacters ?? [],
        guidelineShortlist: ctxState?.guidelineShortlist ?? [],
        knowledgeShortlist: ctxState?.knowledgeShortlist ?? [],
        characterShortlist: ctxState?.characterShortlist ?? [],
        systemPromptFragments: [],
        modelId,
        ...extra,
      }

      // 6. Create tools
      let allTools: ToolSet
      if (config.readOnly === 'none') {
        allTools = {}
      } else {
        const fragmentTools = createFragmentTools(dataDir, storyId, {
          readOnly: config.readOnly !== false,
        })
        allTools = config.tools
          ? config.tools({ dataDir, storyId, opts, story, fragmentTools })
          : fragmentTools
      }

      // 7. Compile context through block system
      const compiled = await compileAgentContext(dataDir, storyId, config.name, blockContext, allTools)

      // 8. Extract messages
      const systemMessage = compiled.messages.find(m => m.role === 'system')
      const userMessage = compiled.messages.find(m => m.role === 'user')

      // 9. Create agent
      const maxSteps = (opts as Record<string, unknown>).maxSteps as number | undefined
      const agent = createToolAgent({
        model,
        instructions: systemMessage?.content || 'You are a helpful assistant.',
        tools: compiled.tools,
        maxSteps: maxSteps ?? defaultMaxSteps,
        toolChoice: config.toolChoice,
      })

      // 10. Build messages
      const messages = config.messages
        ? config.messages({ compiled, opts })
        : userMessage ? [{ role: 'user' as const, content: userMessage.content }] : []

      // 11. Stream
      const result = await agent.stream({ messages })
      const streamResult = createEventStream(result.fullStream)

      // 12. Track token usage after stream completes
      streamResult.completion.then(async () => {
        try {
          const rawUsage = await result.totalUsage
          if (rawUsage && typeof rawUsage.inputTokens === 'number') {
            reportUsage(dataDir, storyId, config.name, {
              inputTokens: rawUsage.inputTokens,
              outputTokens: rawUsage.outputTokens ?? 0,
            }, modelId)
          }
        } catch {
          // Some providers may not report usage
        }
      }).catch(() => {
        // Stream errored — skip usage tracking
      })

      // 13. Post-stream hook
      if (config.afterStream) {
        config.afterStream(streamResult)
      }

      return streamResult
    })
  }
}
