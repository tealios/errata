import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir } from '../setup'
import { createApp } from '@/server/api'

let dataDir: string
let cleanup: () => Promise<void>
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
  app = createApp(dataDir)
})

afterEach(async () => {
  await cleanup()
})

async function api(path: string, init?: RequestInit) {
  const res = await app.fetch(
    new Request(`http://localhost/api${path}`, init),
  )
  return {
    status: res.status,
    json: async () => res.json(),
  }
}

async function apiJson(path: string, body: unknown, method = 'POST') {
  return api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function createStory(): Promise<string> {
  const res = await apiJson('/stories', { name: 'Test', description: 'Test story' })
  const data = await res.json()
  return data.id
}

describe('Block config export/import routes', () => {
  it('GET /export-configs returns empty object for fresh story', async () => {
    const storyId = await createStory()
    const res = await api(`/stories/${storyId}/export-configs`)
    expect(res.status).toBe(200)
    const data = await res.json()
    // Fresh story has no custom config — both fields should be absent
    expect(data.blockConfig).toBeUndefined()
    expect(data.agentBlockConfigs).toBeUndefined()
  })

  it('GET /export-configs returns 404 for missing story', async () => {
    const res = await api('/stories/nonexistent/export-configs')
    expect(res.status).toBe(404)
  })

  it('GET /export-configs includes blockConfig after customization', async () => {
    const storyId = await createStory()
    // Create a custom block to make the config non-empty
    await apiJson(`/stories/${storyId}/blocks/custom`, {
      id: 'cb-exp001',
      name: 'Export Test',
      role: 'system',
      order: 100,
      enabled: true,
      type: 'simple',
      content: 'Test content for export',
    })
    const res = await api(`/stories/${storyId}/export-configs`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.blockConfig).toBeDefined()
    expect(data.blockConfig.customBlocks).toHaveLength(1)
    expect(data.blockConfig.customBlocks[0].id).toBe('cb-exp001')
  })

  it('POST /import-configs imports blockConfig', async () => {
    const storyId = await createStory()
    const blockConfig = {
      customBlocks: [{
        id: 'cb-imp001',
        name: 'Imported Block',
        role: 'user',
        order: 200,
        enabled: true,
        type: 'simple',
        content: 'Imported content',
      }],
      overrides: { instructions: { enabled: false } },
      blockOrder: ['cb-imp001'],
    }
    const res = await apiJson(`/stories/${storyId}/import-configs`, { blockConfig })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)

    // Verify the config was saved
    const getRes = await api(`/stories/${storyId}/blocks`)
    const saved = await getRes.json()
    expect(saved.config.customBlocks).toHaveLength(1)
    expect(saved.config.customBlocks[0].id).toBe('cb-imp001')
    expect(saved.config.overrides.instructions?.enabled).toBe(false)
  })

  it('POST /import-configs returns 404 for missing story', async () => {
    const res = await apiJson('/stories/nonexistent/import-configs', { blockConfig: { customBlocks: [], overrides: {}, blockOrder: [] } })
    expect(res.status).toBe(404)
  })

  it('POST /import-configs replaces existing config', async () => {
    const storyId = await createStory()
    // Create initial custom block
    await apiJson(`/stories/${storyId}/blocks/custom`, {
      id: 'cb-old001',
      name: 'Old Block',
      role: 'system',
      order: 100,
      enabled: true,
      type: 'simple',
      content: 'Old content',
    })

    // Import replaces entirely
    const blockConfig = {
      customBlocks: [{
        id: 'cb-new001',
        name: 'New Block',
        role: 'user',
        order: 300,
        enabled: true,
        type: 'simple',
        content: 'New content',
      }],
      overrides: {},
      blockOrder: ['cb-new001'],
    }
    await apiJson(`/stories/${storyId}/import-configs`, { blockConfig })

    const getRes = await api(`/stories/${storyId}/blocks`)
    const saved = await getRes.json()
    expect(saved.config.customBlocks).toHaveLength(1)
    expect(saved.config.customBlocks[0].id).toBe('cb-new001')
  })

  it('POST /import-configs with empty body is a no-op', async () => {
    const storyId = await createStory()
    const res = await apiJson(`/stories/${storyId}/import-configs`, {})
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
  })
})

describe('Block API routes', () => {
  it('GET /blocks returns empty config and builtin blocks', async () => {
    const storyId = await createStory()
    const res = await api(`/stories/${storyId}/blocks`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.config.customBlocks).toEqual([])
    expect(data.config.overrides).toEqual({})
    expect(data.builtinBlocks).toBeDefined()
    expect(data.builtinBlocks.length).toBeGreaterThan(0)
    // Should have at least instructions and author-input
    const ids = data.builtinBlocks.map((b: { id: string }) => b.id)
    expect(ids).toContain('instructions')
    expect(ids).toContain('author-input')
  })

  it('GET /blocks returns 404 for missing story', async () => {
    const res = await api('/stories/nonexistent/blocks')
    expect(res.status).toBe(404)
  })

  it('GET /blocks/preview returns compiled messages', async () => {
    const storyId = await createStory()
    const res = await api(`/stories/${storyId}/blocks/preview`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.messages).toBeDefined()
    expect(data.blockCount).toBeGreaterThan(0)
    // Should have at least system and user messages
    const roles = data.messages.map((m: { role: string }) => m.role)
    expect(roles).toContain('system')
    expect(roles).toContain('user')
  })

  it('POST /blocks/custom creates a custom block', async () => {
    const storyId = await createStory()
    const block = {
      id: 'cb-test01',
      name: 'Test Block',
      role: 'user',
      order: 500,
      enabled: true,
      type: 'simple',
      content: 'Hello world',
    }
    const res = await apiJson(`/stories/${storyId}/blocks/custom`, block)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.customBlocks).toHaveLength(1)
    expect(data.customBlocks[0].id).toBe('cb-test01')
    expect(data.blockOrder).toContain('cb-test01')
  })

  it('POST /blocks/custom returns 422 for invalid block', async () => {
    const storyId = await createStory()
    const res = await apiJson(`/stories/${storyId}/blocks/custom`, { name: '' })
    expect(res.status).toBe(422)
  })

  it('PUT /blocks/custom/:blockId updates a custom block', async () => {
    const storyId = await createStory()
    await apiJson(`/stories/${storyId}/blocks/custom`, {
      id: 'cb-upd001',
      name: 'Original',
      role: 'user',
      order: 100,
      enabled: true,
      type: 'simple',
      content: 'Original',
    })

    const res = await apiJson(
      `/stories/${storyId}/blocks/custom/cb-upd001`,
      { name: 'Updated', content: 'New content' },
      'PUT',
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.customBlocks[0].name).toBe('Updated')
  })

  it('PUT /blocks/custom/:blockId returns 404 for missing block', async () => {
    const storyId = await createStory()
    const res = await apiJson(
      `/stories/${storyId}/blocks/custom/cb-noexist`,
      { name: 'Nope' },
      'PUT',
    )
    expect(res.status).toBe(404)
  })

  it('DELETE /blocks/custom/:blockId deletes a block', async () => {
    const storyId = await createStory()
    await apiJson(`/stories/${storyId}/blocks/custom`, {
      id: 'cb-del001',
      name: 'To Delete',
      role: 'system',
      order: 200,
      enabled: true,
      type: 'simple',
      content: 'Delete me',
    })

    const res = await api(`/stories/${storyId}/blocks/custom/cb-del001`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.customBlocks).toHaveLength(0)
  })

  it('PATCH /blocks/config updates overrides and order', async () => {
    const storyId = await createStory()
    const res = await apiJson(
      `/stories/${storyId}/blocks/config`,
      {
        overrides: { instructions: { enabled: false } },
        blockOrder: ['tools', 'instructions'],
      },
      'PATCH',
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.overrides.instructions.enabled).toBe(false)
    expect(data.blockOrder).toEqual(['tools', 'instructions'])
  })

  it('PATCH /blocks/config returns 404 for missing story', async () => {
    const res = await apiJson(
      '/stories/nonexistent/blocks/config',
      { overrides: {} },
      'PATCH',
    )
    expect(res.status).toBe(404)
  })

  // eval-script endpoint tests
  it('POST /blocks/eval-script returns result for valid script', async () => {
    const storyId = await createStory()
    const res = await apiJson(`/stories/${storyId}/blocks/eval-script`, {
      content: 'return `Story: ${ctx.story.name}`',
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.result).toBe('Story: Test')
    expect(data.error).toBeNull()
  })

  it('POST /blocks/eval-script returns error for throwing script', async () => {
    const storyId = await createStory()
    const res = await apiJson(`/stories/${storyId}/blocks/eval-script`, {
      content: 'throw new Error("boom")',
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.result).toBeNull()
    expect(data.error).toContain('boom')
  })

  it('POST /blocks/eval-script returns null result for empty-string return', async () => {
    const storyId = await createStory()
    const res = await apiJson(`/stories/${storyId}/blocks/eval-script`, {
      content: 'return ""',
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.result).toBeNull()
    expect(data.error).toBeNull()
  })

  it('POST /blocks/eval-script returns 404 for missing story', async () => {
    const res = await apiJson('/stories/nonexistent/blocks/eval-script', {
      content: 'return "hello"',
    })
    expect(res.status).toBe(404)
  })

  it('POST /blocks/eval-script supports ctx.getFragmentsByTag()', async () => {
    const storyId = await createStory()
    // Create two fragments with different tags
    await apiJson(`/stories/${storyId}/fragments`, {
      type: 'guideline',
      name: 'Tagged One',
      description: 'Has tag alpha',
      content: 'Content one',
      tags: ['alpha', 'shared'],
    })
    await apiJson(`/stories/${storyId}/fragments`, {
      type: 'knowledge',
      name: 'Tagged Two',
      description: 'Has tag shared',
      content: 'Content two',
      tags: ['beta', 'shared'],
    })
    // getFragmentsByTag should return both with 'shared'
    const res = await apiJson(`/stories/${storyId}/blocks/eval-script`, {
      content: 'const frags = await ctx.getFragmentsByTag("shared"); return frags.map(f => f.name).sort().join(", ")',
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.result).toBe('Tagged One, Tagged Two')
    expect(data.error).toBeNull()
  })

  it('POST /blocks/eval-script supports ctx.getFragmentByTag()', async () => {
    const storyId = await createStory()
    await apiJson(`/stories/${storyId}/fragments`, {
      type: 'guideline',
      name: 'Unique Tag Fragment',
      description: 'Has unique tag',
      content: 'Content here',
      tags: ['unique-tag'],
    })
    const res = await apiJson(`/stories/${storyId}/blocks/eval-script`, {
      content: 'const frag = await ctx.getFragmentByTag("unique-tag"); return frag ? frag.name : "not found"',
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.result).toBe('Unique Tag Fragment')
    expect(data.error).toBeNull()

    // Non-existent tag returns null
    const res2 = await apiJson(`/stories/${storyId}/blocks/eval-script`, {
      content: 'const frag = await ctx.getFragmentByTag("no-such-tag"); return frag ? frag.name : "not found"',
    })
    const data2 = await res2.json()
    expect(data2.result).toBe('not found')
  })

  it('POST /blocks/eval-script supports ctx.getFragments()', async () => {
    const storyId = await createStory()
    // Create a fragment so getFragments returns something
    await apiJson(`/stories/${storyId}/fragments`, {
      type: 'guideline',
      name: 'Test Guideline',
      description: 'A test',
      content: 'Be creative',
    })
    const res = await apiJson(`/stories/${storyId}/blocks/eval-script`, {
      content: 'const frags = await ctx.getFragments("guideline"); return frags.map(f => f.name).join(", ")',
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.result).toBe('Test Guideline')
    expect(data.error).toBeNull()
  })
})
