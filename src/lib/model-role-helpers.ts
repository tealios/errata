import type { ModelRoleInfo, GlobalConfigSafe, StoryMeta } from '@/lib/api/types'

/**
 * Derive the fallback chain from a dot-separated key.
 * Same logic as the server-side registry.
 * e.g. 'librarian.chat' → ['librarian.chat', 'librarian', 'generation']
 */
export function getModelFallbackChain(key: string): string[] {
  const chain: string[] = [key]
  const parts = key.split('.')
  while (parts.length > 1) {
    parts.pop()
    chain.push(parts.join('.'))
  }
  if (chain[chain.length - 1] !== 'generation') {
    chain.push('generation')
  }
  return chain
}

/** Resolve the effective providerId for a role by walking the fallback chain */
export function resolveProvider(
  roleKey: string,
  settings: StoryMeta['settings'],
  globalConfig: GlobalConfigSafe | null,
): string | null {
  const overrides = settings.modelOverrides ?? {}
  const chain = getModelFallbackChain(roleKey)
  for (const r of chain) {
    const pid = overrides[r]?.providerId
    if (pid) return pid
  }
  return globalConfig?.defaultProviderId ?? null
}

/** Resolve the inherited temperature for a role by walking the fallback chain, then falling back to the provider-level temperature */
export function resolveInheritedTemperature(
  roleKey: string,
  settings: StoryMeta['settings'],
  globalConfig: GlobalConfigSafe | null,
): { value: number; source: string } | null {
  const overrides = settings.modelOverrides ?? {}
  const chain = getModelFallbackChain(roleKey)

  // Walk fallback chain (skip self) to find a parent with temperature set
  for (let i = 1; i < chain.length; i++) {
    const parentKey = chain[i]
    const temp = overrides[parentKey]?.temperature
    if (temp != null) {
      return { value: temp, source: parentKey }
    }
  }

  // Fall back to the resolved provider's temperature
  const providerId = resolveProvider(roleKey, settings, globalConfig)
  if (providerId && globalConfig) {
    const provider = globalConfig.providers.find(p => p.id === providerId)
    if (provider?.temperature != null) {
      return { value: provider.temperature, source: provider.name }
    }
  }

  return null
}

/** Get the inherit label for a role's provider dropdown (e.g. "Inherit (Librarian)") */
export function getInheritLabel(
  roleKey: string,
  roles: ModelRoleInfo[],
  settings: StoryMeta['settings'],
  globalConfig: GlobalConfigSafe | null,
): string {
  const overrides = settings.modelOverrides ?? {}
  const chain = getModelFallbackChain(roleKey)

  // Walk fallback chain (skip self) to find which parent has a provider set
  for (let i = 1; i < chain.length; i++) {
    const parentKey = chain[i]
    const pid = overrides[parentKey]?.providerId
    if (pid) {
      const provider = globalConfig?.providers.find(p => p.id === pid)
      const parentRole = roles.find(r => r.key === parentKey)
      return `Inherit${parentRole ? ` \u00b7 ${parentRole.label}` : ''}${provider ? ` (${provider.name})` : ''}`
    }
  }

  // Falls through to global default
  const defaultProvider = globalConfig?.defaultProviderId
    ? globalConfig.providers.find(p => p.id === globalConfig.defaultProviderId)
    : null
  return `Inherit${defaultProvider ? ` (${defaultProvider.name})` : ''}`
}
