import { apiFetch } from './client'
import type { SharingStatusResponse } from './types'

export const sharing = {
  getStatus: () => apiFetch<SharingStatusResponse>('/sharing/status'),
  setAuth: (data: { enabled: boolean; username?: string; password?: string }) =>
    apiFetch<SharingStatusResponse>('/sharing/auth', { method: 'POST', body: JSON.stringify(data) }),
  setLan: (enabled: boolean) =>
    apiFetch<SharingStatusResponse>('/sharing/lan', { method: 'POST', body: JSON.stringify({ enabled }) }),
  setTunnel: (enabled: boolean) =>
    apiFetch<SharingStatusResponse>('/sharing/tunnel', { method: 'POST', body: JSON.stringify({ enabled }) }),
}
