import { describe, it, expect } from 'vitest'
import { generateFragmentId, PREFIXES } from '@/lib/fragment-ids'

describe('generateFragmentId', () => {
  it('generates IDs with correct prefix for each built-in type', () => {
    expect(generateFragmentId('prose')).toMatch(/^pr-[a-z0-9]{6}$/)
    expect(generateFragmentId('character')).toMatch(/^ch-[a-z0-9]{6}$/)
    expect(generateFragmentId('guideline')).toMatch(/^gl-[a-z0-9]{6}$/)
    expect(generateFragmentId('knowledge')).toMatch(/^kn-[a-z0-9]{6}$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateFragmentId('prose'))
    }
    // With 6 chars of base36, collisions in 100 are extremely unlikely
    expect(ids.size).toBe(100)
  })

  it('falls back to first 4 chars for unknown types', () => {
    const id = generateFragmentId('custom')
    expect(id).toMatch(/^cust-[a-z0-9]{6}$/)
  })
})

describe('PREFIXES', () => {
  it('has entries for all built-in types', () => {
    expect(PREFIXES.prose).toBe('pr')
    expect(PREFIXES.character).toBe('ch')
    expect(PREFIXES.guideline).toBe('gl')
    expect(PREFIXES.knowledge).toBe('kn')
  })
})
