import type { GlobalConfigSafe } from '@/lib/api/types'

interface ProviderSelectProps {
  value: string | null
  globalConfig: GlobalConfigSafe | null
  onChange: (providerId: string | null) => void
  disabled?: boolean
  inheritLabel?: string
}

export function ProviderSelect({ value, globalConfig, onChange, disabled, inheritLabel }: ProviderSelectProps) {
  const defaultProvider = globalConfig?.defaultProviderId
    ? globalConfig.providers.find(p => p.id === globalConfig.defaultProviderId)
    : null

  const emptyLabel = inheritLabel
    ? inheritLabel
    : defaultProvider
      ? defaultProvider.name
      : 'DeepSeek (env)'

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full h-[26px] px-2 text-[11px] text-foreground/80 bg-muted/50 border border-border/50 rounded-md focus:border-primary/30 focus:outline-none truncate"
      disabled={disabled}
    >
      <option value="">
        {emptyLabel}
      </option>
      {(globalConfig?.providers ?? []).map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  )
}
