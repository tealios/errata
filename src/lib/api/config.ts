import { apiFetch } from './client'
import type { GlobalConfigSafe } from './types'

export const config = {
  getProviders: () =>
    apiFetch<GlobalConfigSafe>('/config/providers'),
  addProvider: (data: { name: string; preset?: string; baseURL: string; apiKey: string; defaultModel: string; customHeaders?: Record<string, string>; temperature?: number }) =>
    apiFetch<GlobalConfigSafe>('/config/providers', { method: 'POST', body: JSON.stringify(data) }),
  updateProvider: (providerId: string, data: { name?: string; baseURL?: string; apiKey?: string; defaultModel?: string; enabled?: boolean; customHeaders?: Record<string, string>; temperature?: number }) =>
    apiFetch<GlobalConfigSafe>(`/config/providers/${providerId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProvider: (providerId: string) =>
    apiFetch<GlobalConfigSafe>(`/config/providers/${providerId}`, { method: 'DELETE' }),
  duplicateProvider: (providerId: string) =>
    apiFetch<GlobalConfigSafe>(`/config/providers/${providerId}/duplicate`, { method: 'POST' }),
  setDefaultProvider: (providerId: string | null) =>
    apiFetch<{ ok: boolean; defaultProviderId: string | null }>('/config/default-provider', {
      method: 'PATCH',
      body: JSON.stringify({ providerId }),
    }),
  listModels: (providerId: string) =>
    apiFetch<{ models: Array<{ id: string; owned_by?: string }>; error?: string }>(`/config/providers/${providerId}/models`),
  testModels: (data: { baseURL: string; apiKey: string; customHeaders?: Record<string, string> }) =>
    apiFetch<{ models: Array<{ id: string; owned_by?: string }>; error?: string }>('/config/test-models', { method: 'POST', body: JSON.stringify(data) }),
  testConnection: (data: { providerId?: string; baseURL?: string; apiKey?: string; model: string; customHeaders?: Record<string, string> }) =>
    apiFetch<{ ok: boolean; reply?: string; error?: string }>('/config/test-connection', { method: 'POST', body: JSON.stringify(data) }),
}
