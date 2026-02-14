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
    new Request(`http://localhost/api${path}`, init)
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

// --- Story Routes ---

describe('Story API routes', () => {
  const story = {
    name: 'Test Story',
    description: 'A test story',
  }

  it('POST /api/stories creates a story', async () => {
    const res = await apiJson('/stories', story)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBeDefined()
    expect(data.name).toBe('Test Story')
  })

  it('GET /api/stories lists stories', async () => {
    await apiJson('/stories', story)
    await apiJson('/stories', { name: 'Second', description: 'Another' })
    const res = await api('/stories')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(2)
  })

  it('GET /api/stories/:id gets a story', async () => {
    const created = await (await apiJson('/stories', story)).json()
    const res = await api(`/stories/${created.id}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.name).toBe('Test Story')
  })

  it('GET /api/stories/:id returns 404 for unknown', async () => {
    const res = await api('/stories/nonexistent')
    expect(res.status).toBe(404)
  })

  it('PUT /api/stories/:id updates a story', async () => {
    const created = await (await apiJson('/stories', story)).json()
    const res = await apiJson(
      `/stories/${created.id}`,
      { name: 'Updated', description: 'Updated desc' },
      'PUT'
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.name).toBe('Updated')
  })

  it('DELETE /api/stories/:id deletes a story', async () => {
    const created = await (await apiJson('/stories', story)).json()
    const res = await api(`/stories/${created.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const listRes = await api('/stories')
    const data = await listRes.json()
    expect(data).toHaveLength(0)
  })
})

// --- Fragment Routes ---

describe('Fragment API routes', () => {
  let storyId: string

  beforeEach(async () => {
    const created = await (
      await apiJson('/stories', { name: 'Test', description: 'Test' })
    ).json()
    storyId = created.id
  })

  const fragment = {
    type: 'prose',
    name: 'Opening',
    description: 'The story begins',
    content: 'It was a dark and stormy night...',
  }

  it('POST /api/stories/:sid/fragments creates a fragment', async () => {
    const res = await apiJson(`/stories/${storyId}/fragments`, fragment)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toMatch(/^pr-/)
    expect(data.name).toBe('Opening')
  })

  it('GET /api/stories/:sid/fragments lists fragments', async () => {
    await apiJson(`/stories/${storyId}/fragments`, fragment)
    await apiJson(`/stories/${storyId}/fragments`, {
      ...fragment,
      name: 'Second',
    })
    const res = await api(`/stories/${storyId}/fragments`)
    const data = await res.json()
    expect(data).toHaveLength(2)
  })

  it('GET /api/stories/:sid/fragments?type=prose filters by type', async () => {
    await apiJson(`/stories/${storyId}/fragments`, fragment)
    await apiJson(`/stories/${storyId}/fragments`, {
      type: 'character',
      name: 'Alice',
      description: 'Main character',
      content: 'A brave hero',
    })
    const res = await api(`/stories/${storyId}/fragments?type=prose`)
    const data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].type).toBe('prose')
  })

  it('GET /api/stories/:sid/fragments/:fid gets a fragment', async () => {
    const created = await (
      await apiJson(`/stories/${storyId}/fragments`, fragment)
    ).json()
    const res = await api(`/stories/${storyId}/fragments/${created.id}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content).toBe('It was a dark and stormy night...')
  })

  it('GET /api/stories/:sid/fragments/:fid returns 404', async () => {
    const res = await api(`/stories/${storyId}/fragments/pr-zzzz`)
    expect(res.status).toBe(404)
  })

  it('PUT /api/stories/:sid/fragments/:fid updates a fragment', async () => {
    const created = await (
      await apiJson(`/stories/${storyId}/fragments`, fragment)
    ).json()
    const res = await apiJson(
      `/stories/${storyId}/fragments/${created.id}`,
      {
        content: 'New content',
        description: 'Updated desc',
        name: 'Updated',
      },
      'PUT'
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content).toBe('New content')
  })

  it('PATCH /api/stories/:sid/fragments/:fid edits content', async () => {
    const created = await (
      await apiJson(`/stories/${storyId}/fragments`, fragment)
    ).json()
    const res = await apiJson(
      `/stories/${storyId}/fragments/${created.id}`,
      {
        oldText: 'dark and stormy',
        newText: 'bright and sunny',
      },
      'PATCH'
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content).toContain('bright and sunny')
  })

  it('DELETE /api/stories/:sid/fragments/:fid requires archiving first', async () => {
    const created = await (
      await apiJson(`/stories/${storyId}/fragments`, fragment)
    ).json()
    // Cannot delete non-archived fragment
    const res = await api(`/stories/${storyId}/fragments/${created.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('archived')
  })

  it('DELETE /api/stories/:sid/fragments/:fid deletes an archived fragment', async () => {
    const created = await (
      await apiJson(`/stories/${storyId}/fragments`, fragment)
    ).json()
    // Archive first
    const archiveRes = await api(`/stories/${storyId}/fragments/${created.id}/archive`, {
      method: 'POST',
    })
    expect(archiveRes.status).toBe(200)
    // Now delete
    const res = await api(`/stories/${storyId}/fragments/${created.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const listRes = await api(`/stories/${storyId}/fragments?includeArchived=true`)
    const data = await listRes.json()
    expect(data).toHaveLength(0)
  })

  it('POST /api/stories/:sid/fragments/:fid/archive archives a fragment', async () => {
    const created = await (
      await apiJson(`/stories/${storyId}/fragments`, fragment)
    ).json()
    const res = await api(`/stories/${storyId}/fragments/${created.id}/archive`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.archived).toBe(true)
    // Fragment should not appear in normal list
    const listRes = await api(`/stories/${storyId}/fragments`)
    const listData = await listRes.json()
    expect(listData).toHaveLength(0)
    // But should appear with includeArchived
    const archivedRes = await api(`/stories/${storyId}/fragments?includeArchived=true`)
    const archivedData = await archivedRes.json()
    expect(archivedData).toHaveLength(1)
    expect(archivedData[0].archived).toBe(true)
  })

  it('POST /api/stories/:sid/fragments/:fid/restore restores a fragment', async () => {
    const created = await (
      await apiJson(`/stories/${storyId}/fragments`, fragment)
    ).json()
    // Archive then restore
    await api(`/stories/${storyId}/fragments/${created.id}/archive`, { method: 'POST' })
    const res = await api(`/stories/${storyId}/fragments/${created.id}/restore`, { method: 'POST' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.archived).toBe(false)
    // Should appear in normal list again
    const listRes = await api(`/stories/${storyId}/fragments`)
    const listData = await listRes.json()
    expect(listData).toHaveLength(1)
  })
})

// --- Fragment Types Route ---

describe('Fragment types route', () => {
  let storyId: string

  beforeEach(async () => {
    const created = await (
      await apiJson('/stories', { name: 'Test', description: 'Test' })
    ).json()
    storyId = created.id
  })

  it('GET /api/stories/:sid/fragment-types returns types', async () => {
    const res = await api(`/stories/${storyId}/fragment-types`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.map((t: { type: string }) => t.type).sort()).toEqual([
      'character',
      'guideline',
      'icon',
      'image',
      'knowledge',
      'prose',
    ])
  })
})
