export interface ModelRoleDefinition {
  key: string
  label: string
  description: string
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

  /**
   * Derive the fallback chain from a dot-separated key.
   * e.g. 'librarian.chat' → ['librarian.chat', 'librarian', 'generation']
   *      'prewriter' → ['prewriter', 'generation']
   *      'generation' → ['generation']
   */
  getFallbackChain(key: string): string[] {
    const chain: string[] = [key]
    const parts = key.split('.')
    // Walk up the hierarchy: drop the last segment each time
    while (parts.length > 1) {
      parts.pop()
      chain.push(parts.join('.'))
    }
    // Always end at 'generation' if not already there
    if (chain[chain.length - 1] !== 'generation') {
      chain.push('generation')
    }
    return chain
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
})
