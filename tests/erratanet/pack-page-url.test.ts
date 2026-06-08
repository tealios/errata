import { describe, it, expect } from 'vitest'
import { packPageUrl } from '@/lib/erratanet/pack-schema'

describe('packPageUrl', () => {
  it('builds a pack page URL from the hub base and id', () => {
    expect(packPageUrl('https://errata.tealios.com', '@tester/duo-pack')).toBe(
      'https://errata.tealios.com/@tester/duo-pack',
    )
  })

  it('trims trailing slashes and surrounding whitespace on the hub URL', () => {
    expect(packPageUrl('  https://errata.tealios.com/  ', '@a/b')).toBe(
      'https://errata.tealios.com/@a/b',
    )
  })

  it('returns null when the hub URL is missing', () => {
    expect(packPageUrl('', '@tester/duo-pack')).toBeNull()
    expect(packPageUrl(undefined, '@tester/duo-pack')).toBeNull()
    expect(packPageUrl(null, '@tester/duo-pack')).toBeNull()
  })

  it('returns null when the id is not a valid global pack id', () => {
    expect(packPageUrl('https://errata.tealios.com', 'not-a-pack')).toBeNull()
    expect(packPageUrl('https://errata.tealios.com', '@tester')).toBeNull()
  })
})
