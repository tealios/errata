import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiFetch, ApiError } from '@/lib/api/client'

afterEach(() => vi.unstubAllGlobals())

describe('librarian stream signals', () => {
  it('passes the abort signal through transformProseSelection to fetch', async () => {
    const seen: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      seen.push(init.signal as AbortSignal)
      return new Response('', { status: 200 })
    }))
    const { librarian } = await import('@/lib/api/librarian')
    const ac = new AbortController()
    await librarian.transformProseSelection('s', 'pr-1', 'rewrite', 'x', { signal: ac.signal })
    expect(seen[0].aborted).toBe(false)
    ac.abort()
    expect(seen[0].aborted).toBe(true)
  })
})

describe('apiFetch', () => {
  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    expect(await apiFetch('/x')).toBeUndefined()
  })
  it('returns undefined for empty 200 body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    expect(await apiFetch('/x')).toBeUndefined()
  })
  it('parses json bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"a":1}', { status: 200 })))
    expect(await apiFetch('/x')).toEqual({ a: 1 })
  })
  it('keeps ApiError message a string when error is an object', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 })))
    const err = (await apiFetch('/x').catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('bad')
  })
})
