import { z, type ZodTypeAny } from 'zod/v4'
import type { Logger } from '../logging'

export type AgentRunStatus = 'success' | 'error'

export interface AgentTraceEntry {
  runId: string
  parentRunId: string | null
  rootRunId: string
  agentName: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: AgentRunStatus
  error?: string
  output?: Record<string, unknown>
}

export interface AgentCallOptions {
  maxDepth?: number
  maxCalls?: number
  timeoutMs?: number
}

export interface AgentInvocationContext {
  dataDir: string
  storyId: string
  logger: Logger
  runId: string
  parentRunId: string | null
  rootRunId: string
  depth: number
  invokeAgent: <TInput, TOutput>(name: string, input: TInput) => Promise<TOutput>
}

export interface AgentDefinition<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
> {
  name: string
  description: string
  inputSchema: TInputSchema
  outputSchema?: TOutputSchema
  allowedCalls?: string[]
  run: (
    ctx: AgentInvocationContext,
    input: z.infer<TInputSchema>,
  ) => Promise<TOutputSchema extends ZodTypeAny ? z.infer<TOutputSchema> : unknown>
}

export interface AgentRunResult<TOutput = unknown> {
  runId: string
  output: TOutput
  trace: AgentTraceEntry[]
}
