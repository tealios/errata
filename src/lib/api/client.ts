import type { ChatEvent } from './types'

const API_BASE = '/api'

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
    throw new Error(err.error ?? `API error: ${res.status}`)
  }
  return res.json()
}

/**
 * Calls the generate endpoint and returns a ReadableStream of text chunks.
 */
export async function fetchStream(
  path: string,
  body: Record<string, unknown>,
): Promise<ReadableStream<string>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `API error: ${res.status}`)
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
        controller.close()
        return
      }
      controller.enqueue(decoder.decode(value, { stream: true }))
    },
  })
}

/**
 * Fetches an NDJSON event stream via GET and returns a ReadableStream of parsed ChatEvent objects.
 */
export async function fetchGetEventStream(path: string): Promise<ReadableStream<ChatEvent>> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `API error: ${res.status}`)
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
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `API error: ${res.status}`)
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
  })
}
