import { createLogger } from '../logging'
import { agentRegistry } from './registry'
import { ensureCoreAgentsRegistered } from './register-core'
import { recordAgentRun } from './traces'
import type {
  AgentCallOptions,
  AgentInvocationContext,
  AgentRunResult,
  AgentTraceEntry,
} from './types'

function computeTraceDurationMs(startedAt: string | undefined, finishedAt: string | undefined): number {
  if (!startedAt || !finishedAt) return 0
  const start = Date.parse(startedAt)
  const finish = Date.parse(finishedAt)
  if (Number.isNaN(start) || Number.isNaN(finish)) return 0
  return Math.max(0, finish - start)
}

interface RuntimeState {
  rootRunId: string
  trace: AgentTraceEntry[]
  stack: string[]
  callCount: number
  options: Required<AgentCallOptions>
}

const runnerLogger = createLogger('agent-runner')

function makeRunId(): string {
  return `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, agentName: string): Promise<T> {
  if (timeoutMs <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Agent timed out: ${agentName} (${timeoutMs}ms)`))
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function invokeInternal<TOutput>(args: {
  dataDir: string
  storyId: string
  agentName: string
  input: unknown
  runtime: RuntimeState
  parentRunId: string | null
  depth: number
}): Promise<{ runId: string; output: TOutput }> {
  const definition = agentRegistry.get(args.agentName)
  if (!definition) {
    throw new Error(`Agent not registered: ${args.agentName}`)
  }

  if (args.runtime.callCount >= args.runtime.options.maxCalls) {
    throw new Error(`Agent call limit exceeded (${args.runtime.options.maxCalls})`)
  }

  if (args.depth > args.runtime.options.maxDepth) {
    throw new Error(`Agent call depth exceeded (${args.runtime.options.maxDepth})`)
  }

  if (args.runtime.stack.includes(args.agentName)) {
    const path = [...args.runtime.stack, args.agentName].join(' -> ')
    throw new Error(`Agent cycle detected: ${path}`)
  }

  const parentName = args.runtime.stack[args.runtime.stack.length - 1]
  if (parentName) {
    const parentDef = agentRegistry.get(parentName)
    const allowed = parentDef?.allowedCalls
    if (allowed && !allowed.includes(args.agentName)) {
      throw new Error(`Agent ${parentName} cannot call ${args.agentName}`)
    }
  }

  args.runtime.callCount += 1
  args.runtime.stack.push(args.agentName)

  const runId = makeRunId()
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const logger = runnerLogger.child({ storyId: args.storyId })
  logger.info('Agent run started', {
    runId,
    rootRunId: args.runtime.rootRunId,
    parentRunId: args.parentRunId,
    agentName: args.agentName,
    depth: args.depth,
  })

  try {
    const parsedInput = definition.inputSchema.parse(args.input)
    const context: AgentInvocationContext = {
      dataDir: args.dataDir,
      storyId: args.storyId,
      logger,
      runId,
      parentRunId: args.parentRunId,
      rootRunId: args.runtime.rootRunId,
      depth: args.depth,
      invokeAgent: async (name, input) => {
        const nested = await invokeInternal({
          dataDir: args.dataDir,
          storyId: args.storyId,
          agentName: name,
          input,
          runtime: args.runtime,
          parentRunId: runId,
          depth: args.depth + 1,
        })
        return nested.output
      },
    }

    const rawOutput = await withTimeout(
      Promise.resolve(definition.run(context, parsedInput)),
      args.runtime.options.timeoutMs,
      args.agentName,
    )
    const output = definition.outputSchema ? definition.outputSchema.parse(rawOutput) : rawOutput
    const finishedAt = new Date().toISOString()
    const durationMs = Date.now() - startedMs

    // Attach serializable output to trace for visibility in the Activity panel.
    // Only include plain-object outputs (skip streams, functions, etc.).
    let traceOutput: Record<string, unknown> | undefined
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      try {
        // Round-trip through JSON to ensure serialisability and drop non-JSON values
        traceOutput = JSON.parse(JSON.stringify(output)) as Record<string, unknown>
      } catch {
        // Not serializable — skip
      }
    }

    args.runtime.trace.push({
      runId,
      parentRunId: args.parentRunId,
      rootRunId: args.runtime.rootRunId,
      agentName: args.agentName,
      startedAt,
      finishedAt,
      durationMs,
      status: 'success',
      output: traceOutput,
    })
    logger.info('Agent run completed', { runId, agentName: args.agentName, durationMs })
    return { runId, output: output as TOutput }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const durationMs = Date.now() - startedMs
    const errorMessage = error instanceof Error ? error.message : String(error)
    args.runtime.trace.push({
      runId,
      parentRunId: args.parentRunId,
      rootRunId: args.runtime.rootRunId,
      agentName: args.agentName,
      startedAt,
      finishedAt,
      durationMs,
      status: 'error',
      error: errorMessage,
    })
    logger.error('Agent run failed', {
      runId,
      agentName: args.agentName,
      durationMs,
      error: errorMessage,
    })
    throw error
  } finally {
    args.runtime.stack.pop()
  }
}

export async function invokeAgent<TOutput = unknown>(args: {
  dataDir: string
  storyId: string
  agentName: string
  input: unknown
  options?: AgentCallOptions
}): Promise<AgentRunResult<TOutput>> {
  ensureCoreAgentsRegistered()

  const options: Required<AgentCallOptions> = {
    maxDepth: args.options?.maxDepth ?? 3,
    maxCalls: args.options?.maxCalls ?? 20,
    timeoutMs: args.options?.timeoutMs ?? 60000 * 5, 
  }

  const runtime: RuntimeState = {
    rootRunId: makeRunId(),
    trace: [],
    stack: [],
    callCount: 0,
    options,
  }

  try {
    const result = await invokeInternal<TOutput>({
      dataDir: args.dataDir,
      storyId: args.storyId,
      agentName: args.agentName,
      input: args.input,
      runtime,
      parentRunId: null,
      depth: 0,
    })

    const sortedTrace = [...runtime.trace].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    const first = sortedTrace[0]
    const last = sortedTrace[sortedTrace.length - 1]
    recordAgentRun(args.storyId, {
      rootRunId: runtime.rootRunId,
      runId: result.runId,
      storyId: args.storyId,
      agentName: args.agentName,
      status: 'success',
      startedAt: first?.startedAt ?? new Date().toISOString(),
      finishedAt: last?.finishedAt ?? new Date().toISOString(),
      durationMs: computeTraceDurationMs(first?.startedAt, last?.finishedAt),
      trace: sortedTrace,
    })

    return {
      runId: result.runId,
      output: result.output,
      trace: runtime.trace,
    }
  } catch (error) {
    const sortedTrace = [...runtime.trace].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    const first = sortedTrace[0]
    const last = sortedTrace[sortedTrace.length - 1]
    recordAgentRun(args.storyId, {
      rootRunId: runtime.rootRunId,
      runId: first?.runId ?? runtime.rootRunId,
      storyId: args.storyId,
      agentName: args.agentName,
      status: 'error',
      startedAt: first?.startedAt ?? new Date().toISOString(),
      finishedAt: last?.finishedAt ?? new Date().toISOString(),
      durationMs: computeTraceDurationMs(first?.startedAt, last?.finishedAt),
      error: error instanceof Error ? error.message : String(error),
      trace: sortedTrace,
    })
    throw error
  }
}
