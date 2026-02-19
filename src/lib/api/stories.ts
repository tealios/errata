import { apiFetch } from './client'
import type { StoryMeta } from './types'

const API_BASE = '/api'

export const stories = {
  list: () => apiFetch<StoryMeta[]>('/stories'),
  get: (id: string) => apiFetch<StoryMeta>(`/stories/${id}`),
  create: (data: { name: string; description: string; coverImage?: string | null }) =>
    apiFetch<StoryMeta>('/stories', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { name: string; description: string; summary?: string; coverImage?: string | null }) =>
    apiFetch<StoryMeta>(`/stories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/stories/${id}`, { method: 'DELETE' }),
  exportAsZip: async (storyId: string, options?: { includeLogs?: boolean; includeLibrarian?: boolean }) => {
    const params = new URLSearchParams()
    if (options?.includeLogs) params.set('includeLogs', 'true')
    if (options?.includeLibrarian) params.set('includeLibrarian', 'true')
    const qs = params.toString()
    const res = await fetch(`${API_BASE}/stories/${storyId}/export${qs ? `?${qs}` : ''}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error ?? `Export failed: ${res.status}`)
    }
    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
    const filename = filenameMatch?.[1] ?? `errata-export.zip`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },
  importFromZip: async (file: File): Promise<StoryMeta> => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${API_BASE}/stories/import`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error ?? `Import failed: ${res.status}`)
    }
    return res.json()
  },
}
