import { describe, it, expect } from 'vitest'
import { generateFragmentId, PREFIXES } from '@/lib/fragment-ids'

describe('generateFragmentId', () => {
  it('generates IDs with correct prefix for each built-in type', () => {
    expect(generateFragmentId('prose')).toMatch(/^pr-[a-z0-9]{4}$/)
    expect(generateFragmentId('character')).toMatch(/^ch-[a-z0-9]{4}$/)
    expect(generateFragmentId('guideline')).toMatch(/^gl-[a-z0-9]{4}$/)
    expect(generateFragmentId('knowledge')).toMatch(/^kn-[a-z0-9]{4}$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateFragmentId('prose'))
    }
    // With 4 chars of base36, collisions in 100 are extremely unlikely
    expect(ids.size).toBe(100)
  })

  it('falls back to first 2 chars for unknown types', () => {
    const id = generateFragmentId('custom')
    expect(id).toMatch(/^cu-[a-z0-9]{4}$/)
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
