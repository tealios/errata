import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ProviderConfigSafe } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Trash2, Star, Pencil, RefreshCw, Loader2, X, ArrowLeft, Minus, Zap, Copy } from 'lucide-react'

const PRESETS = {
  deepseek: { name: 'DeepSeek', baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  openai: { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-5.2' },
  anthropic: { name: 'Anthropic', baseURL: 'https://api.anthropic.com/v1', defaultModel: 'claude-opus-4-6' },
  kimi: { name: 'Kimi', baseURL: 'https://api.moonshot.ai/v1', defaultModel: 'kimi-k2.5' },
  'kimi-code': { name: 'Kimi Code', baseURL: 'https://api.kimi.com/coding/v1', defaultModel: 'kimi-for-coding' },
  openrouter: { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', defaultModel: 'deepseek/deepseek-chat-v3-0324' },
  zai: { name: 'Z.AI', baseURL: 'https://api.z.ai/api/paas/v4', defaultModel: 'glm-5' },
  custom: { name: '', baseURL: '', defaultModel: '' },
} as const

type PresetKey = keyof typeof PRESETS

interface FormState {
  preset: PresetKey
  name: string
  baseURL: string
  apiKey: string
  defaultModel: string
  customHeaders: Array<{ key: string; value: string; _id: string }>
  temperature: string // stored as string for input; '' means unset
}

const emptyForm: FormState = { preset: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', apiKey: '', defaultModel: 'deepseek-chat', customHeaders: [], temperature: '' }

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
        <p className="text-xs text-muted-foreground italic">No providers configured. Using DeepSeek via environment variable.</p>
      ) : (
        providers.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5 py-0.5">
            <span className="text-sm truncate">{p.name}</span>
            {defaultId === p.id && (
              <span className="text-[0.625rem] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full shrink-0">default</span>
            )}
            <span className="text-[0.6875rem] text-muted-foreground truncate ml-auto">{p.defaultModel}</span>
          </div>
        ))
      )}
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 w-full" onClick={onManage} data-component-id="provider-list-manage">
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
    mutationFn: (data: { name: string; preset?: string; baseURL: string; apiKey: string; defaultModel: string; customHeaders?: Record<string, string>; temperature?: number }) =>
      api.config.addProvider(data),
    onSuccess: () => { invalidate(); closeForm() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; baseURL?: string; apiKey?: string; defaultModel?: string; customHeaders?: Record<string, string> } }) =>
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

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.config.duplicateProvider(id),
    onSuccess: invalidate,
  })

  const openEdit = (provider: ProviderConfigSafe) => {
    setEditingId(provider.id)
    const headers = provider.customHeaders ?? {}
    setForm({
      preset: (provider.preset as PresetKey) || 'custom',
      name: provider.name,
      baseURL: provider.baseURL,
      apiKey: '',
      defaultModel: provider.defaultModel,
      customHeaders: Object.entries(headers).map(([key, value]) => ({ key, value, _id: crypto.randomUUID() })),
      temperature: provider.temperature != null ? String(provider.temperature) : '',
    })
    setFetchedModels([])
    setFetchError(null)
    setUseCustomModel(false)
  }

  const handlePresetChange = (preset: PresetKey) => {
    if (!form) return
    const p = PRESETS[preset]
    setForm({ preset, name: p.name || form.name, baseURL: p.baseURL || form.baseURL, apiKey: form.apiKey, defaultModel: p.defaultModel || form.defaultModel, customHeaders: form.customHeaders, temperature: form.temperature })
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
        // Auto-select first model if current selection is empty or not in the list
        if (form && result.models.length > 0 && (!form.defaultModel || !result.models.some(m => m.id === form.defaultModel))) {
          setForm({ ...form, defaultModel: result.models[0].id })
        }
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
    const parsedTemp = form.temperature !== '' ? parseFloat(form.temperature) : undefined
    const temperature = parsedTemp != null && !isNaN(parsedTemp) ? parsedTemp : undefined
    if (editingId) {
      const data: Record<string, unknown> = { name: form.name, baseURL: form.baseURL, defaultModel: form.defaultModel, customHeaders: headersRecord, temperature: temperature ?? null }
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
        temperature,
      })
    }
  }

  const providers = config?.providers ?? []
  const defaultId = config?.defaultProviderId ?? null
  const isSaving = addMutation.isPending || updateMutation.isPending
  const canSubmit = form && (editingId
    ? form.name && form.baseURL && form.defaultModel
    : form.name && form.baseURL && form.apiKey && form.defaultModel)

  const inputClass = "w-full h-9 px-3 text-sm text-foreground bg-muted/30 border border-border/50 rounded-md focus:border-primary/30 focus:outline-none"
  const labelClass = "text-xs font-medium text-muted-foreground mb-1.5 block"

  return (
    <div className="flex flex-col h-full" data-component-id="provider-panel-root">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          {form && (
            <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={closeForm} data-component-id="provider-panel-back">
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <h2 className="font-display text-lg">Providers</h2>
          <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wider">
            {form ? (editingId ? 'Edit' : 'Add New') : 'LLM Configuration'}
          </span>
        </div>
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={onClose} data-component-id="provider-panel-close">
          <X className="size-4" />
        </Button>
      </div>

      {form ? (
        /* ─── Add / Edit Form ─── */
        <ScrollArea className="flex-1" data-component-id="provider-form-scroll">
          <div className="max-w-2xl mx-auto p-6 space-y-5">
            {/* Preset selector (only for new providers) */}
            {!editingId && (
              <div>
                <label className={labelClass}>Preset</label>
                <select
                  value={form.preset}
                  onChange={(e) => handlePresetChange(e.target.value as PresetKey)}
                  className={inputClass}
                  data-component-id="provider-form-preset"
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="kimi">Kimi</option>
                  <option value="kimi-code">Kimi Code</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="zai">Z.AI</option>
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
                  className="text-[0.6875rem] text-muted-foreground hover:text-muted-foreground flex items-center gap-0.5 transition-colors"
                  onClick={() => setForm({ ...form, customHeaders: [...form.customHeaders, { key: '', value: '', _id: crypto.randomUUID() }] })}
                >
                  <Plus className="size-3" /> Add
                </button>
              </div>
              {form.customHeaders.length === 0 ? (
                <p className="text-[0.6875rem] text-muted-foreground italic">No custom headers</p>
              ) : (
                <div className="space-y-1.5">
                  {form.customHeaders.map((header, i) => (
                    <div key={header._id} className="flex gap-1.5 items-center">
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
                        className="h-9 w-9 p-0 shrink-0 text-muted-foreground hover:text-destructive"
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
                  className="text-[0.6875rem] text-muted-foreground hover:text-muted-foreground mt-1 underline"
                  onClick={() => setUseCustomModel(!useCustomModel)}
                >
                  {useCustomModel ? 'Use fetched models' : 'Enter model ID manually'}
                </button>
              )}
              {fetchError && (
                <p className="text-xs text-destructive mt-1">{fetchError}</p>
              )}
              {fetchedModels.length > 0 && !fetchError && (
                <p className="text-[0.6875rem] text-muted-foreground mt-1">{fetchedModels.length} models available</p>
              )}
            </div>

            {/* Temperature */}
            <div>
              <label className={labelClass}>Temperature</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                  className={inputClass + ' w-32'}
                  placeholder="Default"
                />
                {form.temperature !== '' && (
                  <button
                    type="button"
                    className="text-[0.6875rem] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setForm({ ...form, temperature: '' })}
                  >
                    Reset
                  </button>
                )}
              </div>
              <p className="text-[0.6875rem] text-muted-foreground mt-1">
                Controls randomness (0 = deterministic, 2 = most creative). Leave empty for model default.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || isSaving}
                data-component-id="provider-form-submit"
              >
                {isSaving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Provider'}
              </Button>
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={testing || !form.defaultModel}
                className="gap-1.5"
                data-component-id="provider-form-test"
              >
                {testing ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                Test
              </Button>
              <Button variant="outline" onClick={closeForm} data-component-id="provider-form-cancel">Cancel</Button>
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
                <p className="text-sm text-muted-foreground italic mb-4">No providers configured.</p>
                <p className="text-xs text-muted-foreground mb-6">Using DeepSeek via environment variable as fallback.</p>
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
                      <span className="text-[0.625rem] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">default</span>
                    )}
                    {p.preset !== 'custom' && (
                      <span className="text-[0.625rem] text-muted-foreground">{p.preset}</span>
                    )}
                  </div>
                  <div className="text-[0.6875rem] text-muted-foreground mt-0.5 flex gap-3">
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
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Duplicate" onClick={() => duplicateMutation.mutate(p.id)} disabled={duplicateMutation.isPending}>
                    <Copy className="size-3.5" />
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

      {/* Creator */}
      <div className="px-6 py-3 border-t border-border/30 text-center">
        <span className="text-[0.625rem] text-muted-foreground">
          built by{' '}
          <a
            href="https://github.com/tealios/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-muted-foreground transition-colors underline underline-offset-2"
          >
            Tealios
          </a>
        </span>
      </div>
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
