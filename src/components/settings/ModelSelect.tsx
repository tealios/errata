import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'

interface ModelSelectProps {
  providerId: string | null
  value: string | null
  onChange: (modelId: string | null) => void
  disabled?: boolean
  defaultLabel?: string
}

export function ModelSelect({ providerId, value, onChange, disabled, defaultLabel = 'Default' }: ModelSelectProps) {
  const [manualEntry, setManualEntry] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['provider-models', providerId],
    queryFn: () => api.config.listModels(providerId!),
    enabled: !!providerId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const models = data?.models ?? []
  const hasModels = models.length > 0
  const fetchFailed = !!data?.error && !hasModels

  // If no provider, show disabled placeholder
  if (!providerId) {
    return (
      <select
        disabled
        className="w-full max-w-[140px] h-[26px] px-2 text-[11px] text-muted-foreground/40 bg-muted/30 border border-border/30 rounded-md"
      >
        <option>No provider</option>
      </select>
    )
  }

  // Manual text input mode (for when model list can't be fetched)
  if (manualEntry || (fetchFailed && !isLoading)) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="model-id"
          className="w-full max-w-[120px] h-[26px] px-2 text-[11px] text-foreground/80 bg-muted/50 border border-border/50 rounded-md focus:border-foreground/20 focus:outline-none font-mono placeholder:text-muted-foreground/30"
          disabled={disabled}
        />
        {hasModels && (
          <button
            type="button"
            onClick={() => setManualEntry(false)}
            className="text-[9px] text-muted-foreground/30 hover:text-foreground/50 transition-colors shrink-0"
            title="Switch to dropdown"
          >
            list
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full max-w-[140px] h-[26px] px-2 text-[11px] text-foreground/80 bg-muted/50 border border-border/50 rounded-md focus:border-primary/30 focus:outline-none truncate"
        disabled={disabled || isLoading}
      >
        <option value="">{isLoading ? 'Loading\u2026' : defaultLabel}</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>{m.id}</option>
        ))}
      </select>
      {hasModels && (
        <button
          type="button"
          onClick={() => setManualEntry(true)}
          className="text-[9px] text-muted-foreground/30 hover:text-foreground/50 transition-colors shrink-0"
          title="Type model ID manually"
        >
          edit
        </button>
      )}
    </div>
  )
}
