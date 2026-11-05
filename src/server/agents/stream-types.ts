// NDJSON event types emitted by agent streams
export type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; toolName: string; result: unknown }
  /** A tool call that failed: invalid input, or `execute` threw. */
  | { type: 'tool-error'; id: string; toolName: string; args: Record<string, unknown>; error: string }
  /** The provider/stream itself failed; the model's reply is incomplete. */
  | { type: 'error'; error: string }
  | { type: 'finish'; finishReason: string; stepCount: number }

export interface AgentToolCallRecord {
  toolName: string
  args: Record<string, unknown>
  result: unknown
  /** Set when the call failed instead of producing a result. */
  error?: string
}

export interface AgentStreamCompletion {
  text: string
  reasoning: string
  toolCalls: AgentToolCallRecord[]
  stepCount: number
  finishReason: string
  /** Stream-level error message, when the provider failed mid-generation. */
  error?: string
}

export interface AgentStreamResult {
  eventStream: ReadableStream<string>
  completion: Promise<AgentStreamCompletion>
}

// Backwards-compat aliases
export type ChatStreamEvent = AgentStreamEvent
export type ChatResult = AgentStreamResult
