import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { createTempDir, makeTestSettings } from '../setup'
import { importStoryFromZip } from '@/server/story-archive'
import { unwrapPack } from '@/server/erratanet/pack-install'
import { resolveInside } from '@/server/safe-id'

let dataDir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
})
afterEach(async () => {
  await cleanup()
})

const ROOT = 'errata-story-export'

function metaJson() {
  const now = new Date().toISOString()
  return JSON.stringify({
    id: 'orig', name: 'Orig', description: '', coverImage: null, summary: '', createdAt: now, updatedAt: now,
    settings: makeTestSettings(),
  })
}

function branches(ids: string[]) {
  return JSON.stringify({
    branches: ids.map((id, i) => ({ id, name: id, order: i, createdAt: new Date().toISOString() })),
    activeBranchId: ids[0],
  })
}

describe('resolveInside', () => {
  it('accepts nested relative paths and rejects escapes', () => {
    expect(resolveInside('/base', 'a/b.json')).toContain('b.json')
    for (const bad of ['../x', 'a/../../x', '/abs', 'C:/x', 'a\\b', '']) {
      expect(() => resolveInside('/base', bad)).toThrow(/Unsafe path/)
    }
  })
})

describe('importStoryFromZip zip-slip', () => {
  it('rejects branch entries that climb out of the branch dir', async () => {
    const zip = zipSync({
      [`${ROOT}/meta.json`]: strToU8(metaJson()),
      [`${ROOT}/branches.json`]: strToU8(branches(['main'])),
      [`${ROOT}/branches/main/prose-chain.json`]: strToU8('{"entries":[]}'),
      [`${ROOT}/branches/main/../../../../../escaped.txt`]: strToU8('pwned'),
    })
    await expect(importStoryFromZip(dataDir, zip)).rejects.toThrow(/Unsafe path/)
    expect(existsSync(join(dirname(dataDir), 'escaped.txt'))).toBe(false)
  })

  it('rejects traversal branch ids from branches.json', async () => {
    const zip = zipSync({
      [`${ROOT}/meta.json`]: strToU8(metaJson()),
      [`${ROOT}/branches.json`]: strToU8(branches(['../../evil'])),
      [`${ROOT}/branches/../../evil/prose-chain.json`]: strToU8('{"entries":[]}'),
    })
    await expect(importStoryFromZip(dataDir, zip)).rejects.toThrow(/Unsafe path/)
  })

  it('rejects traversal entries in legacy-format archives', async () => {
    const zip = zipSync({
      [`${ROOT}/meta.json`]: strToU8(metaJson()),
      [`${ROOT}/../../../escaped.txt`]: strToU8('pwned'),
    })
    await expect(importStoryFromZip(dataDir, zip)).rejects.toThrow(/Unsafe path/)
  })

  it('unwrapPack rejects story packs with traversal paths', () => {
    const manifest = {
      errataPack: 1, id: '@a/b', version: '1.0.0', title: 'x', description: '', license: 'MIT',
      contentKind: 'story', errataFormatVersion: 1, fragmentTypes: [], fragmentCount: 0, tags: [], capabilities: [],
      payloadHash: 'sha256:x', createdAt: new Date().toISOString(),
    }
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'payload/story/../../evil.json': strToU8('{}'),
    })
    expect(() => unwrapPack(zip)).toThrow(/Invalid story pack: Unsafe path/)
  })
})
