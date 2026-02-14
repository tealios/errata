const API_BASE = '/api'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `API error: ${res.status}`)
  }
  return res.json()
}

// --- Story API ---

export interface StoryMeta {
  id: string
  name: string
  description: string
  summary: string
  createdAt: string
  updatedAt: string
  settings: {
    outputFormat: 'plaintext' | 'markdown'
    enabledPlugins: string[]
  }
}

export interface Fragment {
  id: string
  type: string
  name: string
  description: string
  content: string
  tags: string[]
  refs: string[]
  sticky: boolean
  createdAt: string
  updatedAt: string
  order: number
  meta: Record<string, unknown>
}

export interface FragmentTypeInfo {
  type: string
  prefix: string
  stickyByDefault: boolean
}

/**
 * Calls the generate endpoint and returns a ReadableStream of text chunks.
 */
async function fetchStream(
  path: string,
  body: Record<string, unknown>,
): Promise<ReadableStream<string>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `API error: ${res.status}`)
  }
  if (!res.body) {
    throw new Error('No response body')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  return new ReadableStream<string>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      controller.enqueue(decoder.decode(value, { stream: true }))
    },
  })
}

export const api = {
  stories: {
    list: () => apiFetch<StoryMeta[]>('/stories'),
    get: (id: string) => apiFetch<StoryMeta>(`/stories/${id}`),
    create: (data: { name: string; description: string }) =>
      apiFetch<StoryMeta>('/stories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name: string; description: string }) =>
      apiFetch<StoryMeta>(`/stories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      apiFetch<{ ok: boolean }>(`/stories/${id}`, { method: 'DELETE' }),
  },
  fragments: {
    list: (storyId: string, type?: string) =>
      apiFetch<Fragment[]>(`/stories/${storyId}/fragments${type ? `?type=${type}` : ''}`),
    get: (storyId: string, fragmentId: string) =>
      apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}`),
    create: (storyId: string, data: { type: string; name: string; description: string; content: string }) =>
      apiFetch<Fragment>(`/stories/${storyId}/fragments`, { method: 'POST', body: JSON.stringify(data) }),
    update: (storyId: string, fragmentId: string, data: { name: string; description: string; content: string }) =>
      apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}`, { method: 'PUT', body: JSON.stringify(data) }),
    edit: (storyId: string, fragmentId: string, data: { oldText: string; newText: string }) =>
      apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (storyId: string, fragmentId: string) =>
      apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/${fragmentId}`, { method: 'DELETE' }),
    types: (storyId: string) =>
      apiFetch<FragmentTypeInfo[]>(`/stories/${storyId}/fragment-types`),
    // Tags
    getTags: (storyId: string, fragmentId: string) =>
      apiFetch<{ tags: string[] }>(`/stories/${storyId}/fragments/${fragmentId}/tags`),
    addTag: (storyId: string, fragmentId: string, tag: string) =>
      apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/${fragmentId}/tags`, {
        method: 'POST', body: JSON.stringify({ tag }),
      }),
    removeTag: (storyId: string, fragmentId: string, tag: string) =>
      apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/${fragmentId}/tags`, {
        method: 'DELETE', body: JSON.stringify({ tag }),
      }),
    // Refs
    getRefs: (storyId: string, fragmentId: string) =>
      apiFetch<{ refs: string[]; backRefs: string[] }>(`/stories/${storyId}/fragments/${fragmentId}/refs`),
    addRef: (storyId: string, fragmentId: string, targetId: string) =>
      apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/${fragmentId}/refs`, {
        method: 'POST', body: JSON.stringify({ targetId }),
      }),
    removeRef: (storyId: string, fragmentId: string, targetId: string) =>
      apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/${fragmentId}/refs`, {
        method: 'DELETE', body: JSON.stringify({ targetId }),
      }),
    // Sticky
    toggleSticky: (storyId: string, fragmentId: string, sticky: boolean) =>
      apiFetch<{ ok: boolean; sticky: boolean }>(`/stories/${storyId}/fragments/${fragmentId}/sticky`, {
        method: 'PATCH', body: JSON.stringify({ sticky }),
      }),
  },
  generation: {
    /** Stream prose generation (returns ReadableStream of text chunks) */
    stream: (storyId: string, input: string) =>
      fetchStream(`/stories/${storyId}/generate`, { input, saveResult: false }),
    /** Generate and save as a new prose fragment */
    generateAndSave: (storyId: string, input: string) =>
      fetchStream(`/stories/${storyId}/generate`, { input, saveResult: true }),
  },
}
