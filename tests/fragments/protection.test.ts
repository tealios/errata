import { describe, it, expect } from 'vitest'
import {
  isFragmentLocked,
  getFrozenSections,
  checkContentProtection,
  checkFragmentWrite,
} from '../../src/server/fragments/protection'

describe('isFragmentLocked', () => {
  it('returns true when meta.locked is true', () => {
    expect(isFragmentLocked({ meta: { locked: true } })).toBe(true)
  })

  it('returns false when meta.locked is false', () => {
    expect(isFragmentLocked({ meta: { locked: false } })).toBe(false)
  })

  it('returns false when meta.locked is missing', () => {
    expect(isFragmentLocked({ meta: {} })).toBe(false)
  })

  it('returns false for non-boolean truthy values', () => {
    expect(isFragmentLocked({ meta: { locked: 1 } })).toBe(false)
    expect(isFragmentLocked({ meta: { locked: 'yes' } })).toBe(false)
  })
})

describe('getFrozenSections', () => {
  it('parses valid frozen sections array', () => {
    const meta = {
      frozenSections: [
        { id: 'fs-abc', text: 'Hello world' },
        { id: 'fs-def', text: 'Another section' },
      ],
    }
    const result = getFrozenSections(meta)
    expect(result).toEqual([
      { id: 'fs-abc', text: 'Hello world' },
      { id: 'fs-def', text: 'Another section' },
    ])
  })

  it('returns empty array when frozenSections is missing', () => {
    expect(getFrozenSections({})).toEqual([])
  })

  it('returns empty array when frozenSections is not an array', () => {
    expect(getFrozenSections({ frozenSections: 'invalid' })).toEqual([])
    expect(getFrozenSections({ frozenSections: 42 })).toEqual([])
    expect(getFrozenSections({ frozenSections: null })).toEqual([])
  })

  it('skips malformed entries', () => {
    const meta = {
      frozenSections: [
        { id: 'fs-abc', text: 'Valid' },
        { id: 123, text: 'bad id' },
        { id: 'fs-def' },
        { id: 'fs-ghi', text: '' },
        null,
        'string',
        { id: 'fs-jkl', text: 'Also valid' },
      ],
    }
    const result = getFrozenSections(meta)
    expect(result).toEqual([
      { id: 'fs-abc', text: 'Valid' },
      { id: 'fs-jkl', text: 'Also valid' },
    ])
  })
})

describe('checkContentProtection', () => {
  it('allows when all frozen sections are present in new content', () => {
    const fragment = {
      meta: {
        frozenSections: [
          { id: 'fs-1', text: 'Must keep this' },
          { id: 'fs-2', text: 'And this too' },
        ],
      },
      content: 'Must keep this and And this too plus more',
    }
    const result = checkContentProtection(
      fragment,
      'Must keep this is still here. And this too remains.',
    )
    expect(result.allowed).toBe(true)
  })

  it('rejects when a frozen section is missing from new content', () => {
    const fragment = {
      meta: {
        frozenSections: [
          { id: 'fs-1', text: 'Must keep this' },
          { id: 'fs-2', text: 'And this too' },
        ],
      },
      content: 'Must keep this and And this too',
    }
    const result = checkContentProtection(
      fragment,
      'Must keep this but the second part is gone.',
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('And this too')
  })

  it('allows when there are no frozen sections', () => {
    const fragment = { meta: {}, content: 'Original content' }
    const result = checkContentProtection(fragment, 'Completely different')
    expect(result.allowed).toBe(true)
  })

  it('truncates long frozen section text in reason', () => {
    const longText = 'A'.repeat(100)
    const fragment = {
      meta: { frozenSections: [{ id: 'fs-1', text: longText }] },
      content: longText,
    }
    const result = checkContentProtection(fragment, 'Gone')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('...')
    expect(result.reason!.length).toBeLessThan(200)
  })
})

describe('checkFragmentWrite', () => {
  it('rejects locked fragments regardless of updates', () => {
    const fragment = {
      meta: { locked: true },
      content: 'Some content',
    }
    const result = checkFragmentWrite(fragment, { content: 'New content' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('locked')
  })

  it('rejects locked fragments even with no content changes', () => {
    const fragment = {
      meta: { locked: true },
      content: 'Some content',
    }
    const result = checkFragmentWrite(fragment, {})
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('locked')
  })

  it('checks frozen sections for content changes on unlocked fragments', () => {
    const fragment = {
      meta: {
        frozenSections: [{ id: 'fs-1', text: 'Protected text' }],
      },
      content: 'Some Protected text here',
    }
    const fail = checkFragmentWrite(fragment, { content: 'No protected text' })
    expect(fail.allowed).toBe(false)

    const pass = checkFragmentWrite(fragment, { content: 'Still has Protected text in it' })
    expect(pass.allowed).toBe(true)
  })

  it('allows non-content changes on unlocked fragments', () => {
    const fragment = {
      meta: {
        frozenSections: [{ id: 'fs-1', text: 'Protected text' }],
      },
      content: 'Protected text here',
    }
    const result = checkFragmentWrite(fragment, {})
    expect(result.allowed).toBe(true)
  })

  it('allows content changes on unlocked fragments with no frozen sections', () => {
    const fragment = { meta: {}, content: 'Original' }
    const result = checkFragmentWrite(fragment, { content: 'Completely new' })
    expect(result.allowed).toBe(true)
  })
})
