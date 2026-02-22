import type { ContextBlock } from '../llm/context-builder'
import type { AgentBlockContext } from './agent-block-context'

export interface AgentBlockDefinition {
  agentName: string
  displayName: string
  description: string
  createDefaultBlocks: (ctx: AgentBlockContext) => ContextBlock[]
  availableTools?: string[]
  buildPreviewContext: (dataDir: string, storyId: string) => Promise<AgentBlockContext>
}

class AgentBlockRegistry {
  private definitions = new Map<string, AgentBlockDefinition>()

  register(def: AgentBlockDefinition): void {
    this.definitions.set(def.agentName, def)
  }

  get(name: string): AgentBlockDefinition | undefined {
    return this.definitions.get(name)
  }

  list(): AgentBlockDefinition[] {
    return [...this.definitions.values()]
  }

  clear(): void {
    this.definitions.clear()
  }
}

export const agentBlockRegistry = new AgentBlockRegistry()
