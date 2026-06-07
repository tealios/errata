import { apiFetch } from './client'
import type { ErratapackManifest } from '../erratanet/pack-schema'
import type {
  ErratanetAccount,
  ErratanetConfigResponse,
  ErratanetInstallResponse,
  ErratanetPackDetail,
  ErratanetPublishResponse,
  ErratanetSearchResponse,
  ErratanetUpdatesResponse,
} from './types'

export const erratanet = {
  getConfig: () => apiFetch<ErratanetConfigResponse>('/erratanet/config'),
  setConfig: (data: { hubUrl?: string; token?: string; enabled?: boolean; introSeen?: boolean }) =>
    apiFetch<ErratanetConfigResponse>('/erratanet/config', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getAccount: () => apiFetch<ErratanetAccount>('/erratanet/account'),
  login: (body: { hubUrl: string; identifier: string; password: string }) =>
    apiFetch<ErratanetAccount>('/erratanet/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  search: (q: string) =>
    apiFetch<ErratanetSearchResponse>(`/erratanet/search?q=${encodeURIComponent(q)}`),
  getPack: (id: string, version?: string) =>
    apiFetch<ErratanetPackDetail>(
      `/erratanet/packs/${encodeURIComponent(id)}${version ? `?version=${encodeURIComponent(version)}` : ''}`,
    ),
  publish: (body: {
    bundleJson?: string
    storyId?: string
    /** For a fragment pack published from a story: the fragments it contains. */
    fragmentIds?: string[]
    unlisted?: boolean
    manifest: ErratapackManifest
  }) =>
    apiFetch<ErratanetPublishResponse>('/erratanet/publish', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  install: (body: { id: string; version?: string; targetStoryId?: string; asNewStory?: boolean }) =>
    apiFetch<ErratanetInstallResponse>('/erratanet/install', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  checkUpdates: (storyId: string) =>
    apiFetch<ErratanetUpdatesResponse>(
      `/erratanet/updates?storyId=${encodeURIComponent(storyId)}`,
    ),
}
