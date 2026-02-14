import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ProviderConfigSafe } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Trash2, Star, Pencil, RefreshCw, Loader2, X, ArrowLeft, Minus, Zap } from 'lucide-react'

const PRESETS = {
  deepseek: { name: 'DeepSeek', baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  openai: { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-5.2' },
  anthropic: { name: 'Anthropic', baseURL: 'https://api.anthropic.com/v1', defaultModel: 'claude-opus-4-6' },
  kimi: { name: 'Kimi', baseURL: 'https://api.moonshot.ai/v1', defaultModel: 'kimi-k2.5' },
  'kimi-code': { name: 'Kimi Code', baseURL: 'https://api.kimi.com/coding/v1', defaultModel: 'kimi-for-coding' },
  openrouter: { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', defaultModel: 'deepseek/deepseek-chat-v3-0324' },
  custom: { name: '', baseURL: '', defaultModel: '' },
} as const

type PresetKey = keyof typeof PRESETS

interface FormState {
  preset: PresetKey
  name: string
  baseURL: string
  apiKey: string
  defaultModel: string
  customHeaders: Array<{ key: string; value: string }>
}

const emptyForm: FormState = { preset: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', apiKey: '', defaultModel: 'deepseek-chat', customHeaders: [] }

/**
 * Compact provider list for the settings sidebar.
 * Shows providers with a "Manage Providers" button that opens the full panel.
 */
export function ProviderList({ onManage }: { onManage: () => void }) {
  const { data: config } = useQuery({
    queryKey: ['global-config'],
    queryFn: () => api.config.getProviders(),
  })

  const providers = config?.providers ?? []
  const defaultId = config?.defaultProviderId ?? null

  return (
    <div className="space-y-2">
      {providers.length === 0 ? (
        <p className="text-xs text-muted-foreground/40 italic">No providers configured. Using DeepSeek via environment variable.</p>
      ) : (
        providers.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5 py-0.5">
            <span className="text-sm truncate">{p.name}</span>
            {defaultId === p.id && (
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full shrink-0">default</span>
            )}
            <span className="text-[11px] text-muted-foreground/40 truncate ml-auto">{p.defaultModel}</span>
          </div>
        ))
      )}
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 w-full" onClick={onManage}>
        Manage Providers
      </Button>
    </div>
  )
}

/**
 * Full-page provider management panel, rendered as an overlay like DebugPanel.
 */
export function ProviderPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [fetchedModels, setFetchedModels] = useState<Array<{ id: string; owned_by?: string }>>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [useCustomModel, setUseCustomModel] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; reply?: string; error?: string } | null>(null)

  const { data: config } = useQuery({
    queryKey: ['global-config'],
    queryFn: () => api.config.getProviders(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['global-config'] })

  const addMutation = useMutation({
    mutationFn: (data: { name: string; preset?: string; baseURL: string; apiKey: string; defaultModel: string }) =>
      api.config.addProvider(data),
    onSuccess: () => { invalidate(); closeForm() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; baseURL?: string; apiKey?: string; defaultModel?: string } }) =>
      api.config.updateProvider(id, data),
    onSuccess: () => { invalidate(); closeForm() },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.config.deleteProvider(id),
    onSuccess: invalidate,
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id: string | null) => api.config.setDefaultProvider(id),
    onSuccess: invalidate,
  })

  const closeForm = () => {
    setEditingId(null)
    setForm(null)
    setFetchedModels([])
    setFetchError(null)
    setUseCustomModel(false)
    setTestResult(null)
  }

  const openAdd = () => {
    setEditingId(null)
    setForm({ ...emptyForm })
    setFetchedModels([])
    setFetchError(null)
    setUseCustomModel(false)
  }

  const openEdit = (provider: ProviderConfigSafe) => {
    setEditingId(provider.id)
    const headers = provider.customHeaders ?? {}
    setForm({
      preset: (provider.preset as PresetKey) || 'custom',
      name: provider.name,
      baseURL: provider.baseURL,
      apiKey: '',
      defaultModel: provider.defaultModel,
      customHeaders: Object.entries(headers).map(([key, value]) => ({ key, value })),
    })
    setFetchedModels([])
    setFetchError(null)
    setUseCustomModel(false)
  }

  const handlePresetChange = (preset: PresetKey) => {
    if (!form) return
    const p = PRESETS[preset]
    setForm({ preset, name: p.name || form.name, baseURL: p.baseURL || form.baseURL, apiKey: form.apiKey, defaultModel: p.defaultModel || form.defaultModel, customHeaders: form.customHeaders })
    setFetchedModels([])
    setFetchError(null)
  }

  const getFormHeaders = () => {
    if (!form) return {}
    const h: Record<string, string> = {}
    for (const entry of form.customHeaders) {
      if (entry.key.trim()) h[entry.key.trim()] = entry.value
    }
    return h
  }

  const handleFetchModels = async () => {
    if (!form) return
    setFetchingModels(true)
    setFetchError(null)
    try {
      // For saved providers, use stored credentials; for new ones, use form values
      const result = editingId
        ? await api.config.listModels(editingId)
        : await api.config.testModels({ baseURL: form.baseURL, apiKey: form.apiKey, customHeaders: getFormHeaders() })
      if (result.error) {
        setFetchError(result.error)
      } else {
        setFetchedModels(result.models)
        setUseCustomModel(false)
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch models')
    } finally {
      setFetchingModels(false)
    }
  }

  const handleTestConnection = async () => {
    if (!form || !form.defaultModel) {
      setTestResult({ ok: false, error: 'Model is required to test' })
      return
    }
    if (!editingId && (!form.baseURL || !form.apiKey)) {
      setTestResult({ ok: false, error: 'Base URL and API Key are required' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.config.testConnection({
        providerId: editingId ?? undefined,
        baseURL: form.baseURL || undefined,
        apiKey: form.apiKey || undefined,
        model: form.defaultModel,
        customHeaders: getFormHeaders(),
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = () => {
    if (!form) return
    const headersRecord: Record<string, string> = {}
    for (const h of form.customHeaders) {
      if (h.key.trim()) headersRecord[h.key.trim()] = h.value
    }
    if (editingId) {
      const data: Record<string, unknown> = { name: form.name, baseURL: form.baseURL, defaultModel: form.defaultModel, customHeaders: headersRecord }
      if (form.apiKey) data.apiKey = form.apiKey
      updateMutation.mutate({ id: editingId, data })
    } else {
      addMutation.mutate({
        name: form.name,
        preset: form.preset,
        baseURL: form.baseURL,
        apiKey: form.apiKey,
        defaultModel: form.defaultModel,
        customHeaders: headersRecord,
      })
    }
  }

  const providers = config?.providers ?? []
  const defaultId = config?.defaultProviderId ?? null
  const isSaving = addMutation.isPending || updateMutation.isPending
  const canSubmit = form && (editingId
    ? form.name && form.baseURL && form.defaultModel
    : form.name && form.baseURL && form.apiKey && form.defaultModel)

  const inputClass = "w-full h-9 px-3 text-sm bg-background border border-border/40 rounded-md focus:border-primary/30 focus:outline-none"
  const labelClass = "text-xs font-medium text-muted-foreground/70 mb-1.5 block"

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          {form && (
            <Button size="icon" variant="ghost" className="size-7 text-muted-foreground/50" onClick={closeForm}>
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <h2 className="font-display text-lg">Providers</h2>
          <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">
            {form ? (editingId ? 'Edit' : 'Add New') : 'LLM Configuration'}
          </span>
        </div>
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground/50" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {form ? (
        /* ─── Add / Edit Form ─── */
        <ScrollArea className="flex-1">
          <div className="max-w-2xl mx-auto p-6 space-y-5">
            {/* Preset selector (only for new providers) */}
            {!editingId && (
              <div>
                <label className={labelClass}>Preset</label>
                <select
                  value={form.preset}
                  onChange={(e) => handlePresetChange(e.target.value as PresetKey)}
                  className={inputClass}
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="kimi">Kimi</option>
                  <option value="kimi-code">Kimi Code</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            )}

            {/* Two-column layout for name + base URL */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClass}
                  placeholder="Provider name"
                />
              </div>
              <div>
                <label className={labelClass}>Base URL</label>
                <input
                  value={form.baseURL}
                  onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                  className={inputClass}
                  placeholder="https://api.example.com/v1"
                />
              </div>
            </div>

            {/* API Key */}
            <div>
              <label className={labelClass}>API Key</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                className={inputClass}
                placeholder={editingId ? 'Leave blank to keep current key' : 'Enter API key'}
              />
            </div>

            {/* Custom Headers */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelClass + ' !mb-0'}>Custom Headers</label>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-0.5 transition-colors"
                  onClick={() => setForm({ ...form, customHeaders: [...form.customHeaders, { key: '', value: '' }] })}
                >
                  <Plus className="size-3" /> Add
                </button>
              </div>
              {form.customHeaders.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/40 italic">No custom headers</p>
              ) : (
                <div className="space-y-1.5">
                  {form.customHeaders.map((header, i) => (
                    <div key={i} className="flex gap-1.5 items-center">
                      <input
                        value={header.key}
                        onChange={(e) => {
                          const next = [...form.customHeaders]
                          next[i] = { ...next[i], key: e.target.value }
                          setForm({ ...form, customHeaders: next })
                        }}
                        className={inputClass + ' flex-1'}
                        placeholder="Header name"
                      />
                      <input
                        value={header.value}
                        onChange={(e) => {
                          const next = [...form.customHeaders]
                          next[i] = { ...next[i], value: e.target.value }
                          setForm({ ...form, customHeaders: next })
                        }}
                        className={inputClass + ' flex-[2]'}
                        placeholder="Value"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-9 w-9 p-0 shrink-0 text-muted-foreground/40 hover:text-destructive"
                        onClick={() => {
                          const next = form.customHeaders.filter((_, j) => j !== i)
                          setForm({ ...form, customHeaders: next })
                        }}
                      >
                        <Minus className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Default Model with fetch */}
            <div>
              <label className={labelClass}>Default Model</label>
              <div className="flex gap-2">
                {fetchedModels.length > 0 && !useCustomModel ? (
                  <select
                    value={form.defaultModel}
                    onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                    className={inputClass + ' flex-1'}
                  >
                    {!fetchedModels.some(m => m.id === form.defaultModel) && form.defaultModel && (
                      <option value={form.defaultModel}>{form.defaultModel} (current)</option>
                    )}
                    {fetchedModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}{m.owned_by ? ` (${m.owned_by})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={form.defaultModel}
                    onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                    className={inputClass + ' flex-1'}
                    placeholder="e.g. deepseek-chat"
                  />
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 text-xs gap-1.5 shrink-0"
                  onClick={handleFetchModels}
                  disabled={fetchingModels}
                >
                  {fetchingModels ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                  Fetch Models
                </Button>
              </div>
              {fetchedModels.length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground mt-1 underline"
                  onClick={() => setUseCustomModel(!useCustomModel)}
                >
                  {useCustomModel ? 'Use fetched models' : 'Enter model ID manually'}
                </button>
              )}
              {fetchError && (
                <p className="text-xs text-destructive mt-1">{fetchError}</p>
              )}
              {fetchedModels.length > 0 && !fetchError && (
                <p className="text-[11px] text-muted-foreground/40 mt-1">{fetchedModels.length} models available</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || isSaving}
              >
                {isSaving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Provider'}
              </Button>
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={testing || !form.defaultModel}
                className="gap-1.5"
              >
                {testing ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                Test
              </Button>
              <Button variant="outline" onClick={closeForm}>Cancel</Button>
            </div>
            {testResult && (
              <div className={`text-sm rounded-md p-3 mt-1 ${testResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
                {testResult.ok ? (
                  <p><span className="font-medium">Success:</span> {testResult.reply}</p>
                ) : (
                  <p><span className="font-medium">Error:</span> {testResult.error}</p>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      ) : (
        /* ─── Provider List ─── */
        <ScrollArea className="flex-1">
          <div className="max-w-2xl mx-auto p-6 space-y-2">
            {providers.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground/50 italic mb-4">No providers configured.</p>
                <p className="text-xs text-muted-foreground/40 mb-6">Using DeepSeek via environment variable as fallback.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={openAdd}>
                  <Plus className="size-3" /> Add your first provider
                </Button>
              </div>
            )}

            {providers.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-3 px-4 rounded-lg border border-border/30 group hover:border-border/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    {defaultId === p.id && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">default</span>
                    )}
                    {p.preset !== 'custom' && (
                      <span className="text-[10px] text-muted-foreground/30">{p.preset}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground/40 mt-0.5 flex gap-3">
                    <span>Model: {p.defaultModel}</span>
                    <span>URL: {p.baseURL}</span>
                    <span>Key: {p.apiKey}</span>
                    {p.customHeaders && Object.keys(p.customHeaders).length > 0 && (
                      <span>{Object.keys(p.customHeaders).length} custom header{Object.keys(p.customHeaders).length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {defaultId !== p.id && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Set as default" onClick={() => setDefaultMutation.mutate(p.id)}>
                      <Star className="size-3.5" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => openEdit(p)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" title="Delete" onClick={() => deleteMutation.mutate(p.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}

            {providers.length > 0 && (
              <div className="pt-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={openAdd}>
                  <Plus className="size-3" /> Add Provider
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

/**
 * Hook to fetch models for a given provider ID.
 * Used by SettingsPanel for the model override selector.
 */
export function useModelFetcher() {
  const [models, setModels] = useState<Array<{ id: string; owned_by?: string }>>([])
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchModels = async (providerId: string) => {
    setFetching(true)
    setError(null)
    try {
      const result = await api.config.listModels(providerId)
      if (result.error) {
        setError(result.error)
        setModels([])
      } else {
        setModels(result.models)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch models')
      setModels([])
    } finally {
      setFetching(false)
    }
  }

  const reset = () => {
    setModels([])
    setError(null)
  }

  return { models, fetching, error, fetchModels, reset }
}
