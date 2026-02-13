import { describe, it, expect } from 'vitest'
import {
  FragmentIdSchema,
  FragmentSchema,
  StoryMetaSchema,
  AssociationsSchema,
} from '@/server/fragments/schema'

describe('FragmentIdSchema', () => {
  it('accepts valid fragment IDs', () => {
    const valid = ['pr-a1b2', 'ch-x9y8', 'gl-m3n4', 'kn-p5q6', 'na-abcd1234']
    for (const id of valid) {
      expect(() => FragmentIdSchema.parse(id)).not.toThrow()
    }
  })

  it('rejects invalid fragment IDs', () => {
    const invalid = ['', 'prose-abc', 'PR-A1B2', 'pr_a1b2', 'p-abc', 'pr-ab', 'pr-ABC!']
    for (const id of invalid) {
      expect(() => FragmentIdSchema.parse(id)).toThrow()
    }
  })
})

describe('FragmentSchema', () => {
  const validFragment = {
    id: 'pr-a1b2',
    type: 'prose',
    name: 'Opening Scene',
    description: 'The story begins in a dark forest',
    content: 'It was a dark and stormy night...',
    tags: ['chapter-1'],
    refs: ['ch-x9y8'],
    sticky: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    order: 0,
    meta: {},
  }

  it('accepts a valid fragment', () => {
    const result = FragmentSchema.parse(validFragment)
    expect(result.id).toBe('pr-a1b2')
    expect(result.type).toBe('prose')
  })

  it('applies defaults for optional fields', () => {
    const minimal = {
      id: 'pr-a1b2',
      type: 'prose',
      name: 'Test',
      description: 'Test fragment',
      content: 'Hello',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const result = FragmentSchema.parse(minimal)
    expect(result.tags).toEqual([])
    expect(result.refs).toEqual([])
    expect(result.sticky).toBe(false)
    expect(result.order).toBe(0)
    expect(result.meta).toEqual({})
  })

  it('rejects description longer than 50 characters', () => {
    const bad = { ...validFragment, description: 'x'.repeat(51) }
    expect(() => FragmentSchema.parse(bad)).toThrow()
  })

  it('rejects invalid type', () => {
    const bad = { ...validFragment, type: 'invalid-type' }
    expect(() => FragmentSchema.parse(bad)).toThrow()
  })

  it('accepts all built-in fragment types', () => {
    for (const type of ['prose', 'character', 'guideline', 'knowledge']) {
      const frag = { ...validFragment, type }
      expect(() => FragmentSchema.parse(frag)).not.toThrow()
    }
  })

  it('rejects invalid fragment ID in refs', () => {
    const bad = { ...validFragment, refs: ['INVALID'] }
    expect(() => FragmentSchema.parse(bad)).toThrow()
  })
})

describe('StoryMetaSchema', () => {
  const validStory = {
    id: 'story-1',
    name: 'My Story',
    description: 'A test story',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('accepts a valid story with defaults', () => {
    const result = StoryMetaSchema.parse(validStory)
    expect(result.summary).toBe('')
    expect(result.settings.outputFormat).toBe('markdown')
    expect(result.settings.enabledPlugins).toEqual([])
  })

  it('accepts full story metadata', () => {
    const full = {
      ...validStory,
      summary: 'A story about...',
      settings: {
        outputFormat: 'plaintext' as const,
        enabledPlugins: ['names'],
      },
    }
    const result = StoryMetaSchema.parse(full)
    expect(result.settings.outputFormat).toBe('plaintext')
  })
})

describe('AssociationsSchema', () => {
  it('accepts valid associations', () => {
    const assoc = {
      tagIndex: { 'chapter-1': ['pr-a1b2', 'pr-c3d4'] },
      refIndex: { 'pr-a1b2': ['ch-x9y8'] },
    }
    const result = AssociationsSchema.parse(assoc)
    expect(result.tagIndex['chapter-1']).toHaveLength(2)
  })

  it('applies defaults for empty associations', () => {
    const result = AssociationsSchema.parse({})
    expect(result.tagIndex).toEqual({})
    expect(result.refIndex).toEqual({})
  })
})
