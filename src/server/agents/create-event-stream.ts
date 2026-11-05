import type { AgentStreamEvent, AgentStreamCompletion, AgentStreamResult, AgentToolCallRecord } from './stream-types'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * Converts an AI SDK v6 fullStream into an NDJSON event stream + completion promise.
 * Handles: text-delta, reasoning-delta, tool-call, tool-result, tool-error, error,
 * finish-step, finish.
 *
 * `tool-error` is what the SDK emits when a tool's input fails schema validation
 * or its `execute` throws. It must reach the client: otherwise a failed write
 * looks identical to one that never happened, and the UI never refreshes.
 *
 * @param onCancel - invoked when the returned stream is cancelled (client
 *   disconnect). Wire this to an AbortController so the underlying LLM call
 *   stops instead of running to completion against a dead consumer.
 */
export function createEventStream(
  fullStream: AsyncIterable<unknown>,
  onCancel?: () => void,
): AgentStreamResult {
  let completionResolve: (val: AgentStreamCompletion) => void
  let completionReject: (err: unknown) => void
  const completion = new Promise<AgentStreamCompletion>((resolve, reject) => {
    completionResolve = resolve
    completionReject = reject
  })

  let fullText = ''
  let fullReasoning = ''
  const toolCalls: AgentToolCallRecord[] = []
  // Correlate a tool-result back to the args from its tool-call event.
  const toolCallArgs = new Map<string, Record<string, unknown>>()
  let lastFinishReason = 'unknown'
  let stepCount = 0
  let streamError: string | undefined

  const eventStream = new ReadableStream<string>({
    async start(controller) {
      try {
        for await (const part of fullStream) {
          let event: AgentStreamEvent | null = null
          const p = part as Record<string, unknown>
          const type = (p as { type?: string }).type

          switch (type) {
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
              const toolCallId = p.toolCallId as string
              toolCallArgs.set(toolCallId, input)
              event = {
                type: 'tool-call',
                id: toolCallId,
                toolName: p.toolName as string,
                args: input,
              }
              break
            }
            case 'tool-result': {
              const toolCallId = p.toolCallId as string
              const toolName = (p.toolName as string) ?? ''
              toolCalls.push({ toolName, args: toolCallArgs.get(toolCallId) ?? {}, result: p.output })
              event = {
                type: 'tool-result',
                id: toolCallId,
                toolName,
                result: p.output,
              }
              break
            }
            case 'tool-error': {
              const toolCallId = p.toolCallId as string
              const toolName = (p.toolName as string) ?? ''
              const args = toolCallArgs.get(toolCallId)
                ?? ((p.input && typeof p.input === 'object') ? p.input as Record<string, unknown> : {})
              const error = errorMessage(p.error)
              toolCalls.push({ toolName, args, result: undefined, error })
              event = { type: 'tool-error', id: toolCallId, toolName, args, error }
              break
            }
            case 'error': {
              streamError = errorMessage(p.error)
              event = { type: 'error', error: streamError }
              break
            }
            // `finish-step` fires once per LLM step; `finish` fires once for the
            // whole generation. Count steps, capture the final reason.
            case 'finish-step':
              stepCount++
              break
            case 'finish':
              lastFinishReason = (p.finishReason as string) ?? 'unknown'
              break
          }

          if (event) {
            controller.enqueue(JSON.stringify(event) + '\n')
          }
        }

        // Emit final finish event
        const finishEvent: AgentStreamEvent = {
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
          ...(streamError !== undefined ? { error: streamError } : {}),
        })
      } catch (err) {
        controller.error(err)
        completionReject!(err)
      }
    },
    cancel() {
      // Consumer (HTTP client) went away — stop the underlying LLM call.
      onCancel?.()
    },
  })

  return { eventStream, completion }
}
