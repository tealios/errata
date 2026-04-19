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

describe('Per-agent config export/import routes', () => {
  it('GET /agent-blocks/:agentName/export returns config for agent', async () => {
    const storyId = await createStory()
    // Ensure agents are registered (normally triggered by other routes)
    await api('/agent-blocks')
    // First add a custom block to the agent
    await apiJson(`/stories/${storyId}/agent-blocks/generation.writer/custom`, {
      id: 'cb-agexp1',
      name: 'Agent Export Test',
      role: 'system',
      order: 100,
      enabled: true,
      type: 'simple',
      content: 'Custom agent block content',
    })

    const res = await api(`/stories/${storyId}/agent-blocks/generation.writer/export-config`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.agentName).toBe('generation.writer')
    expect(data.displayName).toBeTypeOf('string')
    expect(data.config).toBeDefined()
    expect(data.config.customBlocks).toHaveLength(1)
    expect(data.config.customBlocks[0].id).toBe('cb-agexp1')
  })

  it('GET /agent-blocks/:agentName/export returns empty config for uncustomized agent', async () => {
    const storyId = await createStory()
    const res = await api(`/stories/${storyId}/agent-blocks/generation.writer/export-config`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.config.customBlocks).toEqual([])
    expect(data.config.overrides).toEqual({})
  })

  it('GET /agent-blocks/:agentName/export returns 404 for missing story', async () => {
    const res = await api('/stories/nonexistent/agent-blocks/generation.writer/export-config')
    expect(res.status).toBe(404)
  })

  it('GET /agent-blocks/:agentName/export returns 404 for unknown agent', async () => {
    const storyId = await createStory()
    const res = await api(`/stories/${storyId}/agent-blocks/nonexistent.agent/export`)
    expect(res.status).toBe(404)
  })

  it('POST /agent-blocks/:agentName/import saves config', async () => {
    const storyId = await createStory()
    const config = {
      customBlocks: [{
        id: 'cb-agimp1',
        name: 'Imported Agent Block',
        role: 'user',
        order: 200,
        enabled: true,
        type: 'simple',
        content: 'Imported content',
      }],
      overrides: { instructions: { enabled: false } },
      blockOrder: ['cb-agimp1'],
      disabledTools: ['read_fragment'],
    }
    const res = await apiJson(`/stories/${storyId}/agent-blocks/generation.writer/import-config`, { config })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)

    // Verify the config was saved
    const getRes = await api(`/stories/${storyId}/agent-blocks/generation.writer`)
    const saved = await getRes.json()
    expect(saved.config.customBlocks).toHaveLength(1)
    expect(saved.config.customBlocks[0].id).toBe('cb-agimp1')
    expect(saved.config.overrides.instructions?.enabled).toBe(false)
    expect(saved.config.disabledTools).toContain('read_fragment')
  })

  it('POST /agent-blocks/:agentName/import replaces existing config', async () => {
    const storyId = await createStory()
    // Create initial config
    await apiJson(`/stories/${storyId}/agent-blocks/generation.writer/custom`, {
      id: 'cb-agold1',
      name: 'Old Block',
      role: 'system',
      order: 100,
      enabled: true,
      type: 'simple',
      content: 'Old content',
    })

    // Import replaces entirely
    const config = {
      customBlocks: [{
        id: 'cb-agnew1',
        name: 'New Block',
        role: 'user',
        order: 300,
        enabled: true,
        type: 'simple',
        content: 'New content',
      }],
      overrides: {},
      blockOrder: ['cb-agnew1'],
      disabledTools: [],
    }
    await apiJson(`/stories/${storyId}/agent-blocks/generation.writer/import-config`, { config })

    const getRes = await api(`/stories/${storyId}/agent-blocks/generation.writer`)
    const saved = await getRes.json()
    expect(saved.config.customBlocks).toHaveLength(1)
    expect(saved.config.customBlocks[0].id).toBe('cb-agnew1')
  })

  it('POST /agent-blocks/:agentName/import returns 422 for missing config', async () => {
    const storyId = await createStory()
    const res = await apiJson(`/stories/${storyId}/agent-blocks/generation.writer/import-config`, {})
    expect(res.status).toBe(422)
  })

  it('POST /agent-blocks/:agentName/import returns 404 for missing story', async () => {
    const res = await apiJson('/stories/nonexistent/agent-blocks/generation.writer/import-config', {
      config: { customBlocks: [], overrides: {}, blockOrder: [], disabledTools: [] },
    })
    expect(res.status).toBe(404)
  })

  it('roundtrip: export then import into same agent', async () => {
    const storyId = await createStory()
    // Customize
    await apiJson(`/stories/${storyId}/agent-blocks/generation.writer/custom`, {
      id: 'cb-round1',
      name: 'Roundtrip Block',
      role: 'system',
      order: 100,
      enabled: true,
      type: 'simple',
      content: 'Roundtrip content',
    })

    // Export
    const exportRes = await api(`/stories/${storyId}/agent-blocks/generation.writer/export-config`)
    const exported = await exportRes.json()

    // Create a second story and import into it
    const storyId2 = await createStory()
    const importRes = await apiJson(`/stories/${storyId2}/agent-blocks/generation.writer/import-config`, {
      config: exported.config,
    })
    expect(importRes.status).toBe(200)

    // Verify
    const getRes = await api(`/stories/${storyId2}/agent-blocks/generation.writer`)
    const saved = await getRes.json()
    expect(saved.config.customBlocks).toHaveLength(1)
    expect(saved.config.customBlocks[0].id).toBe('cb-round1')
  })

  it('DELETE /agent-blocks/:agentName/custom/:blockId removes a custom block', async () => {
    const storyId = await createStory()
    await apiJson(`/stories/${storyId}/agent-blocks/generation.writer/custom`, {
      id: 'cb-agdel1',
      name: 'Delete Me',
      role: 'system',
      order: 100,
      enabled: true,
      type: 'simple',
      content: 'Temporary block',
    })

    const deleteRes = await api(`/stories/${storyId}/agent-blocks/generation.writer/custom/cb-agdel1`, {
      method: 'DELETE',
    })

    expect(deleteRes.status).toBe(200)
    const deleted = await deleteRes.json()
    expect(deleted.customBlocks).toEqual([])
    expect(deleted.blockOrder).not.toContain('cb-agdel1')

    const getRes = await api(`/stories/${storyId}/agent-blocks/generation.writer`)
    const saved = await getRes.json()
    expect(saved.config.customBlocks).toEqual([])
  })

  it('DELETE /agent-blocks/:agentName/custom/:blockId accepts content-type json without a body', async () => {
    const storyId = await createStory()
    await apiJson(`/stories/${storyId}/agent-blocks/generation.writer/custom`, {
      id: 'cb-agdel2',
      name: 'Delete Me Too',
      role: 'system',
      order: 100,
      enabled: true,
      type: 'simple',
      content: 'Temporary block',
    })

    const deleteRes = await api(`/stories/${storyId}/agent-blocks/generation.writer/custom/cb-agdel2`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(deleteRes.status).toBe(200)
    const deleted = await deleteRes.json()
    expect(deleted.customBlocks).toEqual([])
  })
})

describe('Bundle export/import routes', () => {
  it('GET /export-configs returns empty object for fresh story', async () => {
    const storyId = await createStory()
    const res = await api(`/stories/${storyId}/export-configs`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.agentBlockConfigs).toBeUndefined()
  })

  it('GET /export-configs returns 404 for missing story', async () => {
    const res = await api('/stories/nonexistent/export-configs')
    expect(res.status).toBe(404)
  })

  it('GET /export-configs includes agent configs after customization', async () => {
    const storyId = await createStory()
    await apiJson(`/stories/${storyId}/agent-blocks/generation.writer/custom`, {
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
    expect(data.agentBlockConfigs).toBeDefined()
    expect(data.agentBlockConfigs['generation.writer'].customBlocks).toHaveLength(1)
    expect(data.agentBlockConfigs['generation.writer'].customBlocks[0].id).toBe('cb-exp001')
  })

  it('POST /import-configs imports agentBlockConfigs', async () => {
    const storyId = await createStory()
    const payload = {
      agentBlockConfigs: {
        'generation.writer': {
          customBlocks: [{
            id: 'cb-imp001',
            name: 'Imported Block',
            role: 'user',
            order: 200,
            enabled: true,
            type: 'simple',
            content: 'Imported content',
          }],
          overrides: {},
          blockOrder: ['cb-imp001'],
          disabledTools: [],
        },
      },
    }
    const res = await apiJson(`/stories/${storyId}/import-configs`, payload)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)

    const getRes = await api(`/stories/${storyId}/agent-blocks/generation.writer`)
    const saved = await getRes.json()
    expect(saved.config.customBlocks).toHaveLength(1)
    expect(saved.config.customBlocks[0].id).toBe('cb-imp001')
  })

  it('POST /import-configs silently ignores legacy blockConfig payloads', async () => {
    const storyId = await createStory()
    const res = await apiJson(`/stories/${storyId}/import-configs`, {
      blockConfig: {
        customBlocks: [{ id: 'cb-legacy', name: 'Legacy', role: 'user', order: 0, enabled: true, type: 'simple', content: 'x' }],
        overrides: {},
        blockOrder: [],
      },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('POST /import-configs returns 404 for missing story', async () => {
    const res = await apiJson('/stories/nonexistent/import-configs', {})
    expect(res.status).toBe(404)
  })

  it('POST /import-configs with empty body is a no-op', async () => {
    const storyId = await createStory()
    const res = await apiJson(`/stories/${storyId}/import-configs`, {})
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})

describe('POST /blocks/eval-script', () => {
  it('returns result for valid script', async () => {
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
