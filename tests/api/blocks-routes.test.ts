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
