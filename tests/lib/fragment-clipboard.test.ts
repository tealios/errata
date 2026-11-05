import { describe, it, expect } from 'vitest'
import { parseBundleClipboard, parseFragmentClipboard } from '@/lib/fragment-clipboard'

const entry = (over: Record<string, unknown> = {}) => ({ type: 'character', name: 'A', description: 'd', content: 'c', ...over })
const bundle = (e: unknown) => JSON.stringify({ _errata: 'fragment-bundle', version: 1, fragments: [e] })

describe('parseBundleClipboard validation', () => {
  it('accepts valid entries', () => {
    expect(parseBundleClipboard(bundle(entry({ attachments: [{ kind: 'image', name: 'i', content: 'x' }] })))).not.toBeNull()
  })
  it('rejects descriptions over 250 chars', () => {
    expect(parseBundleClipboard(bundle(entry({ description: 'x'.repeat(251) })))).toBeNull()
  })
  it('rejects invalid attachment kinds', () => {
    expect(parseBundleClipboard(bundle(entry({ attachments: [{ kind: 'video', name: 'i', content: 'x' }] })))).toBeNull()
  })
  it('validates single fragment descriptions too', () => {
    const text = JSON.stringify({ _errata: 'fragment', version: 1, fragment: entry({ description: 'x'.repeat(300) }) })
    expect(parseFragmentClipboard(text)).toBeNull()
  })
})
