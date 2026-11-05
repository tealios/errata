import { describe, expect, it } from 'vitest'
import { StorySetupSnapshotSchema } from '@/server/story-setup/schema'

const checklist = [
  'starting-point', 'premise', 'characters', 'goal', 'setting', 'voice', 'opening',
].map(key => ({ key, status: 'partial' as const, note: '' }))

function character(i: number, overrides: Record<string, unknown> = {}) {
  return {
    key: `side-${i}`,
    type: 'character',
    name: `Side character ${i}`,
    description: `Minor figure ${i}`,
    content: `Side character ${i} lingers at the edge of scenes.`,
    ...overrides,
  }
}

describe('StorySetupSnapshotSchema', () => {
  it('accepts a cast larger than a dozen fragments', () => {
    const fragments = Array.from({ length: 15 }, (_, i) => character(i))
    const parsed = StorySetupSnapshotSchema.safeParse({ story: null, checklist, fragments })
    expect(parsed.success).toBe(true)
  })

  it('accepts descriptions up to the app-wide 250 character limit', () => {
    const parsed = StorySetupSnapshotSchema.safeParse({
      story: null,
      checklist,
      fragments: [character(0, { description: 'x'.repeat(250) })],
    })
    expect(parsed.success).toBe(true)
    expect(StorySetupSnapshotSchema.safeParse({
      story: null,
      checklist,
      fragments: [character(0, { description: 'x'.repeat(251) })],
    }).success).toBe(false)
  })

  it('lets content be omitted so unchanged fragments need not be resent', () => {
    const parsed = StorySetupSnapshotSchema.safeParse({
      story: null,
      checklist,
      fragments: [character(0, { content: undefined })],
    })
    expect(parsed.success).toBe(true)
  })
})
