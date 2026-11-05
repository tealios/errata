import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory, getStory, listFragments } from '@/server/fragments/storage'
import { getProseChain } from '@/server/fragments/prose-chain'
import { syncStorySetupSnapshot } from '@/server/story-setup/sync'
import type { StoryMeta } from '@/server/fragments/schema'

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-setup-sync',
    name: 'New Story',
    description: '',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
  }
}

describe('story setup fragment sync', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const temp = await createTempDir()
    dataDir = temp.path
    cleanup = temp.cleanup
    await createStory(dataDir, makeStory())
  })

  afterEach(async () => cleanup())

  it('creates real fragments immediately and revises them by stable setup key', async () => {
    const first = await syncStorySetupSnapshot(dataDir, 'story-setup-sync', {
      story: { name: 'The Memory Courier', description: 'A courier carries a stolen memory.' },
      fragments: [{
        key: 'mara',
        type: 'character',
        name: 'Mara',
        description: 'Courier with a stolen memory',
        content: 'Mara is a cautious courier.',
      }],
    })

    expect(first.fragments).toHaveLength(1)
    expect(first.fragments[0]).toMatchObject({ key: 'mara', type: 'character', name: 'Mara' })
    expect(first.fragments[0].id).toMatch(/^ch-/)

    const second = await syncStorySetupSnapshot(dataDir, 'story-setup-sync', {
      story: { name: 'The Memory Courier', description: 'A courier risks her identity for a stolen memory.' },
      fragments: [{
        key: 'mara',
        type: 'character',
        name: 'Mara Venn',
        description: 'Courier risking her identity',
        content: 'Mara risks her identity to deliver the memory.',
      }],
    })

    expect(second.fragments[0].id).toBe(first.fragments[0].id)
    const fragments = await listFragments(dataDir, 'story-setup-sync')
    expect(fragments).toHaveLength(1)
    expect(fragments[0]).toMatchObject({
      name: 'Mara Venn',
      version: 2,
      meta: { storySetupKey: 'mara' },
    })
    expect((await getStory(dataDir, 'story-setup-sync'))?.name).toBe('The Memory Courier')
  })

  it('adds generated opening prose to the prose chain', async () => {
    const result = await syncStorySetupSnapshot(dataDir, 'story-setup-sync', {
      story: null,
      fragments: [{
        key: 'opening',
        type: 'prose',
        name: 'Opening',
        description: 'The courier reaches the gate',
        content: 'The gate remembered Mara before she remembered herself.',
      }],
    })

    const chain = await getProseChain(dataDir, 'story-setup-sync')
    expect(chain?.entries[0].proseFragments[0]).toBe(result.fragments[0].id)
  })
})

describe('story setup fragment sync: partial snapshots', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const temp = await createTempDir()
    dataDir = temp.path
    cleanup = temp.cleanup
    await createStory(dataDir, makeStory())
  })

  afterEach(async () => cleanup())

  it('keeps existing content when a resent fragment omits it', async () => {
    await syncStorySetupSnapshot(dataDir, 'story-setup-sync', {
      story: null,
      fragments: [{
        key: 'mara',
        type: 'character',
        name: 'Mara',
        description: 'Courier',
        content: 'Mara is a cautious courier.',
      }],
    })

    const result = await syncStorySetupSnapshot(dataDir, 'story-setup-sync', {
      story: null,
      fragments: [
        { key: 'mara', type: 'character', name: 'Mara Venn', description: 'Courier' },
        { key: 'city', type: 'knowledge', name: 'The City', description: 'Setting', content: 'A city of canals.' },
      ],
    })

    expect(result.fragments.find(f => f.key === 'mara')?.content).toBe('Mara is a cautious courier.')
    const fragments = await listFragments(dataDir, 'story-setup-sync')
    const mara = fragments.find(f => f.meta.storySetupKey === 'mara')
    expect(mara).toMatchObject({ name: 'Mara Venn', content: 'Mara is a cautious courier.', version: 2 })
    expect(fragments.find(f => f.meta.storySetupKey === 'city')).toBeDefined()
  })

  it('refuses a brand-new fragment that has no content', async () => {
    await expect(syncStorySetupSnapshot(dataDir, 'story-setup-sync', {
      story: null,
      fragments: [{ key: 'ghost', type: 'character', name: 'Ghost', description: 'No body' }],
    })).rejects.toThrow(/content/i)
  })

  it('reports fragments that were left out of the snapshot but still exist', async () => {
    await syncStorySetupSnapshot(dataDir, 'story-setup-sync', {
      story: null,
      fragments: [
        { key: 'mara', type: 'character', name: 'Mara', description: 'Courier', content: 'Mara.' },
        { key: 'city', type: 'knowledge', name: 'The City', description: 'Setting', content: 'Canals.' },
      ],
    })

    const result = await syncStorySetupSnapshot(dataDir, 'story-setup-sync', {
      story: null,
      fragments: [{ key: 'mara', type: 'character', name: 'Mara', description: 'Courier' }],
    })

    // Omitted fragments are not deleted; they are returned so the caller can show the real set.
    expect(result.fragments.map(f => f.key).sort()).toEqual(['city', 'mara'])
    expect(await listFragments(dataDir, 'story-setup-sync')).toHaveLength(2)
  })
})
