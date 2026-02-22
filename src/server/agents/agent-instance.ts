import { createLogger } from '../logging'
import { agentRegistry } from './registry'
import { ensureCoreAgentsRegistered } from './register-core'
import { recordAgentRun } from './traces'
import { registerActiveAgent, unregisterActiveAgent } from './active-registry'
import type { AgentInvocationContext, AgentTraceEntry } from './types'
import type { AgentStreamResult, AgentStreamCompletion } from './stream-types'

/**
 * Maps agent name literals to their parsed input types.
 * Each agent registration file augments this via declaration merging.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AgentInputMap {}

/** Resolve input type: known agents get their specific type, others fall back to Record<string, unknown>. */
type AgentInput<K extends string> = K extends keyof AgentInputMap ? AgentInputMap[K] : Record<string, unknown>

export interface AgentInstance<K extends string = string> {
  readonly agentName: K
  execute(input: AgentInput<K>): Promise<AgentStreamResult>
  /** Record failure if the runner threw before producing a stream. Idempotent. */
  fail(error: unknown): void
}

function makeRunId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function safeSerialize(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function createAgentInstance<K extends string>(
  agentName: K,
  context: { dataDir: string; storyId: string },
): AgentInstance<K> {
  ensureCoreAgentsRegistered()

  const definition = agentRegistry.get(agentName)
  if (!definition) {
    throw new Error(`Agent not registered: ${agentName}`)
  }

  let settled = false
  let activityId: string | undefined
  let startedAt: string | undefined
  let startMs: number | undefined
  let serializedInput: Record<string, unknown> | undefined
  const runId = makeRunId()
  const logger = createLogger(agentName).child({ storyId: context.storyId })

  function finish(status: 'success' | 'error', resultOrError: unknown): void {
    if (settled) return
    settled = true

    if (activityId) {
      unregisterActiveAgent(activityId)
    }

    const finishedAt = new Date().toISOString()
    const durationMs = startMs ? Date.now() - startMs : 0

    let serializedOutput: Record<string, unknown> | undefined
    let errorMessage: string | undefined

    if (status === 'success') {
      const completion = resultOrError as AgentStreamCompletion
      serializedOutput = safeSerialize({
        text: completion.text,
        reasoning: completion.reasoning,
        toolCalls: completion.toolCalls,
        stepCount: completion.stepCount,
        finishReason: completion.finishReason,
      })
    } else {
      errorMessage = resultOrError instanceof Error
        ? resultOrError.message
        : String(resultOrError)
    }

    const traceEntry: AgentTraceEntry = {
      runId,
      parentRunId: null,
      rootRunId: runId,
      agentName,
      startedAt: startedAt ?? finishedAt,
      finishedAt,
      durationMs,
      status,
      ...(status === 'error' ? { error: errorMessage } : {}),
      ...(serializedOutput ? { output: serializedOutput } : {}),
    }

    recordAgentRun(context.storyId, {
      rootRunId: runId,
      runId,
      storyId: context.storyId,
      agentName,
      status,
      startedAt: startedAt ?? finishedAt,
      finishedAt,
      durationMs,
      ...(errorMessage ? { error: errorMessage } : {}),
      input: serializedInput,
      output: serializedOutput,
      trace: [traceEntry],
    })
  }

  return {
    agentName,

    async execute(input: AgentInput<K>): Promise<AgentStreamResult> {
      const parsedInput = definition.inputSchema.parse(input)
      serializedInput = safeSerialize(parsedInput)

      startedAt = new Date().toISOString()
      startMs = Date.now()
      activityId = registerActiveAgent(context.storyId, agentName)

      const invocationContext: AgentInvocationContext = {
        dataDir: context.dataDir,
        storyId: context.storyId,
        logger,
        runId,
        parentRunId: null,
        rootRunId: runId,
        depth: 0,
        invokeAgent: async () => {
          throw new Error('Nested agent calls not supported via createAgentInstance')
        },
      }

      const rawOutput = await definition.run(invocationContext, parsedInput)
      const { eventStream, completion } = rawOutput as AgentStreamResult

      const wrappedCompletion = completion.then(
        (result) => {
          finish('success', result)
          return result
        },
        (err) => {
          finish('error', err)
          throw err
        },
      )

      return { eventStream, completion: wrappedCompletion }
    },

    fail(error: unknown): void {
      finish('error', error)
    },
  }
}
