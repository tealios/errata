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
  },
}
