export interface ModelRoleDefinition {
  key: string
  label: string
  description: string
  fallback: string[]
}

class ModelRoleRegistry {
  private definitions = new Map<string, ModelRoleDefinition>()

  register(def: ModelRoleDefinition): void {
    this.definitions.set(def.key, def)
  }

  get(key: string): ModelRoleDefinition | undefined {
    return this.definitions.get(key)
  }

  list(): ModelRoleDefinition[] {
    return [...this.definitions.values()]
  }

  /** Walk the fallback chain for a role, returning [role, ...fallbacks] */
  getFallbackChain(key: string): string[] {
    const def = this.definitions.get(key)
    if (!def) return [key]
    return [key, ...def.fallback]
  }

  clear(): void {
    this.definitions.clear()
  }
}

export const modelRoleRegistry = new ModelRoleRegistry()

// Pre-register the generation role — it exists independently of any agent
modelRoleRegistry.register({
  key: 'generation',
  label: 'Generation',
  description: 'Main prose writing',
  fallback: [],
})
