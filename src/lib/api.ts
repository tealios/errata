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
    summarizationThreshold?: number
    maxSteps?: number
    providerId?: string | null
    modelId?: string | null
    contextOrderMode?: 'simple' | 'advanced'
    fragmentOrder?: string[]
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
  placement: 'system' | 'user'
  createdAt: string
  updatedAt: string
  order: number
  meta: Record<string, unknown>
  archived: boolean
}

export interface FragmentTypeInfo {
  type: string
  prefix: string
  stickyByDefault: boolean
}

export interface GenerationLogSummary {
  id: string
  createdAt: string
  input: string
  fragmentId: string | null
  model: string
  durationMs: number
  toolCallCount: number
  stepCount: number
  stepsExceeded: boolean
}

export interface LibrarianAnalysisSummary {
  id: string
  createdAt: string
  fragmentId: string
  contradictionCount: number
  suggestionCount: number
  timelineEventCount: number
}

export interface LibrarianAnalysis {
  id: string
  createdAt: string
  fragmentId: string
  summaryUpdate: string
  mentionedCharacters: string[]
  contradictions: Array<{
    description: string
    fragmentIds: string[]
  }>
  knowledgeSuggestions: Array<{
    type: 'character' | 'knowledge'
    name: string
    description: string
    content: string
    accepted?: boolean
  }>
  timelineEvents: Array<{
    event: string
    position: 'before' | 'during' | 'after'
  }>
}

export interface LibrarianState {
  lastAnalyzedFragmentId: string | null
  recentMentions: Record<string, string[]>
  timeline: Array<{ event: string; fragmentId: string }>
}

export interface ProviderConfigSafe {
  id: string
  name: string
  preset: string
  baseURL: string
  apiKey: string // masked
  defaultModel: string
  enabled: boolean
  customHeaders?: Record<string, string>
  createdAt: string
}

export interface GlobalConfigSafe {
  providers: ProviderConfigSafe[]
  defaultProviderId: string | null
}

export interface ProseChainEntry {
  proseFragments: Array<{
    id: string
    name: string
    description: string
    createdAt: string
    generationMode?: string
  }>
  active: string
}

export interface ProseChain {
  entries: ProseChainEntry[]
}

export interface GenerationLog {
  id: string
  createdAt: string
  input: string
  messages: Array<{ role: string; content: string }>
  toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>
  generatedText: string
  fragmentId: string | null
  model: string
  durationMs: number
  stepCount: number
  finishReason: string
  stepsExceeded: boolean
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

export interface PluginManifestInfo {
  name: string
  version: string
  description: string
  panel?: { title: string }
}

export const api = {
  plugins: {
    list: () => apiFetch<PluginManifestInfo[]>('/plugins'),
  },
  settings: {
    update: (storyId: string, data: { enabledPlugins?: string[]; outputFormat?: 'plaintext' | 'markdown'; summarizationThreshold?: number; maxSteps?: number; providerId?: string | null; modelId?: string | null; contextOrderMode?: 'simple' | 'advanced'; fragmentOrder?: string[] }) =>
      apiFetch<StoryMeta>(`/stories/${storyId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },
  config: {
    getProviders: () =>
      apiFetch<GlobalConfigSafe>('/config/providers'),
    addProvider: (data: { name: string; preset?: string; baseURL: string; apiKey: string; defaultModel: string; customHeaders?: Record<string, string> }) =>
      apiFetch<GlobalConfigSafe>('/config/providers', { method: 'POST', body: JSON.stringify(data) }),
    updateProvider: (providerId: string, data: { name?: string; baseURL?: string; apiKey?: string; defaultModel?: string; enabled?: boolean; customHeaders?: Record<string, string> }) =>
      apiFetch<GlobalConfigSafe>(`/config/providers/${providerId}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteProvider: (providerId: string) =>
      apiFetch<GlobalConfigSafe>(`/config/providers/${providerId}`, { method: 'DELETE' }),
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
  },
  stories: {
    list: () => apiFetch<StoryMeta[]>('/stories'),
    get: (id: string) => apiFetch<StoryMeta>(`/stories/${id}`),
    create: (data: { name: string; description: string }) =>
      apiFetch<StoryMeta>('/stories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name: string; description: string; summary?: string }) =>
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
    update: (storyId: string, fragmentId: string, data: { name: string; description: string; content: string; sticky?: boolean; order?: number; placement?: 'system' | 'user'; meta?: Record<string, unknown> }) =>
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
    // Revert
    revert: (storyId: string, fragmentId: string) =>
      apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}/revert`, { method: 'POST' }),
    // Reorder (bulk)
    reorder: (storyId: string, items: Array<{ id: string; order: number }>) =>
      apiFetch<{ ok: boolean }>(`/stories/${storyId}/fragments/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      }),
    // Placement
    setPlacement: (storyId: string, fragmentId: string, placement: 'system' | 'user') =>
      apiFetch<{ ok: boolean; placement: string }>(`/stories/${storyId}/fragments/${fragmentId}/placement`, {
        method: 'PATCH',
        body: JSON.stringify({ placement }),
      }),
    // Archive / Restore
    archive: (storyId: string, fragmentId: string) =>
      apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}/archive`, { method: 'POST' }),
    restore: (storyId: string, fragmentId: string) =>
      apiFetch<Fragment>(`/stories/${storyId}/fragments/${fragmentId}/restore`, { method: 'POST' }),
    listArchived: async (storyId: string) => {
      const all = await apiFetch<Fragment[]>(`/stories/${storyId}/fragments?includeArchived=true`)
      return all.filter((f) => f.archived)
    },
  },
  generation: {
    /** Stream prose generation (returns ReadableStream of text chunks) */
    stream: (storyId: string, input: string) =>
      fetchStream(`/stories/${storyId}/generate`, { input, saveResult: false }),
    /** Generate and save as a new prose fragment */
    generateAndSave: (storyId: string, input: string) =>
      fetchStream(`/stories/${storyId}/generate`, { input, saveResult: true }),
    /** Regenerate an existing fragment with a new prompt */
    regenerate: (storyId: string, fragmentId: string, input: string) =>
      fetchStream(`/stories/${storyId}/generate`, { input, saveResult: true, mode: 'regenerate', fragmentId }),
    /** Refine an existing fragment with instructions */
    refine: (storyId: string, fragmentId: string, input: string) =>
      fetchStream(`/stories/${storyId}/generate`, { input, saveResult: true, mode: 'refine', fragmentId }),
    /** List generation log summaries (newest first) */
    listLogs: (storyId: string) =>
      apiFetch<GenerationLogSummary[]>(`/stories/${storyId}/generation-logs`),
    /** Get a full generation log by ID */
    getLog: (storyId: string, logId: string) =>
      apiFetch<GenerationLog>(`/stories/${storyId}/generation-logs/${logId}`),
  },
  librarian: {
    getStatus: (storyId: string) =>
      apiFetch<LibrarianState>(`/stories/${storyId}/librarian/status`),
    listAnalyses: (storyId: string) =>
      apiFetch<LibrarianAnalysisSummary[]>(`/stories/${storyId}/librarian/analyses`),
    getAnalysis: (storyId: string, id: string) =>
      apiFetch<LibrarianAnalysis>(`/stories/${storyId}/librarian/analyses/${id}`),
    acceptSuggestion: (storyId: string, analysisId: string, index: number) =>
      apiFetch<LibrarianAnalysis>(`/stories/${storyId}/librarian/analyses/${analysisId}/suggestions/${index}/accept`, { method: 'POST' }),
  },
  proseChain: {
    get: (storyId: string) =>
      apiFetch<ProseChain>(`/stories/${storyId}/prose-chain`),
    switchVariation: (storyId: string, sectionIndex: number, fragmentId: string) =>
      apiFetch<{ ok: boolean }>(`/stories/${storyId}/prose-chain/${sectionIndex}/switch`, {
        method: 'POST',
        body: JSON.stringify({ fragmentId }),
      }),
    removeSection: (storyId: string, sectionIndex: number) =>
      apiFetch<{ ok: boolean; archivedFragmentIds: string[] }>(`/stories/${storyId}/prose-chain/${sectionIndex}`, {
        method: 'DELETE',
      }),
  },
}
