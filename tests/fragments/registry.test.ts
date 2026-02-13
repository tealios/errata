import { describe, it, expect, beforeEach } from 'vitest'
import {
  FragmentTypeRegistry,
  type FragmentTypeDefinition,
} from '@/server/fragments/registry'
import type { Fragment } from '@/server/fragments/schema'

describe('FragmentTypeRegistry', () => {
  let registry: FragmentTypeRegistry

  beforeEach(() => {
    registry = new FragmentTypeRegistry()
  })

  it('registers built-in types on construction', () => {
    const types = registry.listTypes()
    expect(types.map((t) => t.type).sort()).toEqual([
      'character',
      'guideline',
      'knowledge',
      'prose',
    ])
  })

  it('looks up a type by name', () => {
    const prose = registry.getType('prose')
    expect(prose).toBeDefined()
    expect(prose!.prefix).toBe('pr')
  })

  it('looks up a type by prefix', () => {
    const def = registry.getTypeByPrefix('ch')
    expect(def).toBeDefined()
    expect(def!.type).toBe('character')
  })

  it('returns undefined for unknown type', () => {
    expect(registry.getType('unknown')).toBeUndefined()
  })

  it('returns undefined for unknown prefix', () => {
    expect(registry.getTypeByPrefix('zz')).toBeUndefined()
  })

  it('registers a custom type', () => {
    const custom: FragmentTypeDefinition = {
      type: 'lore',
      prefix: 'lo',
      stickyByDefault: false,
      contextRenderer: (f: Fragment) => f.content,
    }
    registry.register(custom)

    const result = registry.getType('lore')
    expect(result).toBeDefined()
    expect(result!.prefix).toBe('lo')
  })

  it('throws on duplicate type registration', () => {
    const dup: FragmentTypeDefinition = {
      type: 'prose',
      prefix: 'xx',
      stickyByDefault: false,
      contextRenderer: (f: Fragment) => f.content,
    }
    expect(() => registry.register(dup)).toThrow(/already registered/)
  })

  it('throws on duplicate prefix registration', () => {
    const dup: FragmentTypeDefinition = {
      type: 'custom',
      prefix: 'pr', // conflicts with prose
      stickyByDefault: false,
      contextRenderer: (f: Fragment) => f.content,
    }
    expect(() => registry.register(dup)).toThrow(/already in use/)
  })

  it('renders a fragment using its type contextRenderer', () => {
    const fragment: Fragment = {
      id: 'pr-a1b2',
      type: 'prose',
      name: 'Test',
      description: 'A test',
      content: 'Hello world',
      tags: [],
      refs: [],
      sticky: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      order: 0,
      meta: {},
    }
    const rendered = registry.renderContext(fragment)
    expect(rendered).toContain('Hello world')
  })
})
