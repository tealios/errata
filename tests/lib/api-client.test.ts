import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiFetch, ApiError } from '@/lib/api/client'

afterEach(() => vi.unstubAllGlobals())

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
