import { describe, it, expect } from 'vitest'
import { isValidFragmentId, isValidStoryId, isValidBranchId, assertFragmentId, InvalidIdError } from '../../src/server/safe-id'

describe('safe-id', () => {
  it('accepts generated ids', () => {
    expect(isValidFragmentId('pr-bakedo')).toBe(true)
    expect(isValidFragmentId('a-b_-kuzeno')).toBe(true)
    expect(isValidStoryId('my-story-lx3k9a')).toBe(true)
    expect(isValidBranchId('main')).toBe(true)
    expect(isValidBranchId('br-bakedo')).toBe(true)
  })
  it('rejects traversal and separators', () => {
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', '/abs', 'C:\\x', 'a.json', '.hidden', 'a\0b', 'x'.repeat(200)]) {
      expect(isValidFragmentId(bad)).toBe(false)
      expect(isValidStoryId(bad)).toBe(false)
      expect(isValidBranchId(bad)).toBe(false)
    }
    expect(isValidFragmentId(undefined)).toBe(false)
    expect(() => assertFragmentId('../evil')).toThrow(InvalidIdError)
  })
})
