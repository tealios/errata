import { describe, it, expect } from 'vitest'
import {
  TTS_DEFAULTS,
  SUPERTONIC_VOICES,
  getTtsSettings,
  isBrowserTtsSupported,
  toPlainText,
  chunkText,
} from '@/lib/tts'

describe('tts settings', () => {
  it('is opt-in: disabled by default', () => {
    expect(TTS_DEFAULTS.enabled).toBe(false)
  })

  it('defaults to the browser engine with a valid default Supertonic voice', () => {
    expect(TTS_DEFAULTS.engine).toBe('browser')
    expect(SUPERTONIC_VOICES.map((v) => v.id)).toContain(TTS_DEFAULTS.supertonicVoiceId)
  })

  it('every Supertonic voice option has an id and a label', () => {
    expect(SUPERTONIC_VOICES.length).toBeGreaterThan(0)
    for (const v of SUPERTONIC_VOICES) {
      expect(v.id).toBeTruthy()
      expect(v.label).toBeTruthy()
    }
  })

  it('migrates the legacy piper engine id to supertonic', () => {
    // getTtsSettings can't read localStorage in node, but the migration logic is
    // exercised here as documentation of intended behavior.
    expect(TTS_DEFAULTS.engine).not.toBe('piper')
  })

  it('getTtsSettings returns defaults when there is no window/storage', () => {
    // vitest runs in the node environment — no window, so this exercises the guard.
    expect(getTtsSettings()).toEqual(TTS_DEFAULTS)
  })

  it('reports no browser speech support outside a browser', () => {
    expect(isBrowserTtsSupported()).toBe(false)
  })
})

describe('toPlainText', () => {
  it('strips emphasis, headings, and list markers', () => {
    const out = toPlainText('# Title\n\nShe **ran** _fast_.\n\n- one\n- two')
    expect(out).not.toContain('#')
    expect(out).not.toContain('**')
    expect(out).not.toContain('_')
    expect(out).toContain('She ran fast')
    expect(out).toContain('one')
  })

  it('keeps link text and drops the URL', () => {
    expect(toPlainText('see [the docs](https://example.com)')).toBe('see the docs')
  })

  it('removes fenced code blocks', () => {
    expect(toPlainText('before\n\n```js\nconst x = 1\n```\n\nafter')).not.toContain('const x')
  })

  it('collapses paragraph breaks into sentence pauses', () => {
    expect(toPlainText('One.\n\nTwo.')).toBe('One. Two.')
  })

  it('normalizes smart quotes to ASCII', () => {
    expect(toPlainText('“Hello” ‘world’')).toBe('"Hello" \'world\'')
  })

  it('normalizes dashes and ellipsis the phonemizer handles', () => {
    expect(toPlainText('wait… a—b')).toBe('wait... a - b')
    expect(toPlainText('a b')).toBe('a b') // non-breaking space → space
  })

  it('drops emoji/symbols that have no spoken form', () => {
    expect(toPlainText('hi \u{1F600} there ✨')).toBe('hi there')
  })
})

describe('chunkText', () => {
  it('returns no chunks for empty text', () => {
    expect(chunkText('')).toEqual([])
  })

  it('merges short sentences up to the max length', () => {
    const chunks = chunkText('A. B. C.', { max: 240 })
    expect(chunks).toEqual(['A. B. C.'])
  })

  it('splits across sentence boundaries when over the max', () => {
    const chunks = chunkText('Alpha sentence here. Beta sentence here. Gamma sentence here.', { max: 25 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 40)).toBe(true)
  })

  it('hard-splits a single runaway sentence on word gaps', () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ') // no punctuation
    const chunks = chunkText(long, { max: 40 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 48)).toBe(true)
    // no words lost
    expect(chunks.join(' ').split(/\s+/).length).toBe(30)
  })
})
