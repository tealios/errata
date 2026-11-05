import type { ChatEvent } from './types'

const API_BASE = '/api'

/**
 * Error thrown by {@link apiFetch} on a non-OK response. Carries the HTTP
 * status and the parsed error body so callers can react to structured fields
 * (e.g. `requiresConsent` on a 422), not just the message.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function errorMessage(err: unknown, fallback: string): string {
  const value = (err as { error?: unknown } | null)?.error
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object') {
    const msg = (value as { message?: unknown }).message
    if (typeof msg === 'string' && msg) return msg
    try { return JSON.stringify(value) } catch { /* fall through */ }
  }
  return fallback
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(errorMessage(err, `API error: ${res.status}`), res.status, err ?? {})
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/**
 * Calls the generate endpoint and returns a ReadableStream of text chunks.
 */
export async function fetchStream(
  path: string,
  body: Record<string, unknown>,
): Promise<ReadableStream<string>> {
  const abort = new AbortController()
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abort.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(errorMessage(err, `API error: ${res.status}`))
  }
  if (!res.body) {
    throw new Error('No response body')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  return new ReadableStream<string>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        const tail = decoder.decode()
        if (tail) controller.enqueue(tail)
        controller.close()
        return
      }
      controller.enqueue(decoder.decode(value, { stream: true }))
    },
    cancel(reason) {
      abort.abort()
      return reader.cancel(reason).catch(() => {})
    },
  })
}

/**
 * Fetches an NDJSON event stream via GET and returns a ReadableStream of parsed ChatEvent objects.
 */
export async function fetchGetEventStream(path: string): Promise<ReadableStream<ChatEvent>> {
  const abort = new AbortController()
  const res = await fetch(`${API_BASE}${path}`, { signal: abort.signal })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(errorMessage(err, `API error: ${res.status}`))
  }
  if (!res.body) {
    throw new Error('No response body')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  return new ReadableStream<ChatEvent>({
    async pull(controller) {
      while (true) {
        const newlineIdx = buffer.indexOf('\n')
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim()
          buffer = buffer.slice(newlineIdx + 1)
          if (line) {
            try {
              controller.enqueue(JSON.parse(line) as ChatEvent)
            } catch {
              // Skip malformed lines
            }
          }
          return
        }

        const { done, value } = await reader.read()
        if (done) {
          const remaining = buffer.trim()
          if (remaining) {
            try {
              controller.enqueue(JSON.parse(remaining) as ChatEvent)
            } catch {
              // Skip malformed
            }
          }
          controller.close()
          return
        }
        buffer += decoder.decode(value, { stream: true })
      }
    },
    cancel(reason) {
      abort.abort()
      return reader.cancel(reason).catch(() => {})
    },
  })
}

/**
 * Fetches an NDJSON event stream and returns a ReadableStream of parsed ChatEvent objects.
 */
export async function fetchEventStream(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ReadableStream<ChatEvent>> {
  const abort = new AbortController()
  if (signal) {
    if (signal.aborted) abort.abort()
    else signal.addEventListener('abort', () => abort.abort(), { once: true })
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abort.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(errorMessage(err, `API error: ${res.status}`))
  }
  if (!res.body) {
    throw new Error('No response body')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  return new ReadableStream<ChatEvent>({
    async pull(controller) {
      while (true) {
        // Try to extract a complete line from the buffer
        const newlineIdx = buffer.indexOf('\n')
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim()
          buffer = buffer.slice(newlineIdx + 1)
          if (line) {
            try {
              controller.enqueue(JSON.parse(line) as ChatEvent)
            } catch {
              // Skip malformed lines
            }
          }
          return
        }

        // Read more data
        const { done, value } = await reader.read()
        if (done) {
          // Process any remaining buffer
          const remaining = buffer.trim()
          if (remaining) {
            try {
              controller.enqueue(JSON.parse(remaining) as ChatEvent)
            } catch {
              // Skip malformed
            }
          }
          controller.close()
          return
        }
        buffer += decoder.decode(value, { stream: true })
      }
    },
    cancel(reason) {
      abort.abort()
      return reader.cancel(reason).catch(() => {})
    },
  })
}
