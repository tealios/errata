import { describe, it, expect } from 'vitest'
import { bumpVersion } from '@/lib/erratanet/publish-utils'

describe('bumpVersion', () => {
  it('bumps each kind', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })
  it('falls back to 1.0.0 on missing or garbage input', () => {
    expect(bumpVersion(null, 'patch')).toBe('1.0.0')
    expect(bumpVersion('garbage', 'patch')).toBe('1.0.0')
    expect(bumpVersion('a.b.c', 'minor')).toBe('1.0.0')
    expect(bumpVersion('1.x.3', 'major')).toBe('1.0.0')
  })
})
