import type { tool } from 'ai'
import type { Elysia } from 'elysia'
import type { Fragment } from '../fragments/schema'
import type { FragmentTypeDefinition } from '../fragments/registry'
import type { ContextBuildState, ContextMessage } from '../llm/context-builder'

export interface PluginManifest {
  name: string
  version: string
  description: string
  panel?: { title: string }
}

export interface GenerationResult {
  text: string
  fragmentId: string | null
  toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>
}

export interface PluginHooks {
  beforeContext?: (ctx: ContextBuildState) => ContextBuildState | Promise<ContextBuildState>
  beforeGeneration?: (messages: ContextMessage[]) => ContextMessage[] | Promise<ContextMessage[]>
  afterGeneration?: (result: GenerationResult) => GenerationResult | Promise<GenerationResult>
  afterSave?: (fragment: Fragment, storyId: string) => void | Promise<void>
}

export interface WritingPlugin {
  manifest: PluginManifest
  fragmentTypes?: FragmentTypeDefinition[]
  tools?: (dataDir: string, storyId: string) => Record<string, ReturnType<typeof tool>>
  routes?: (app: Elysia) => Elysia
  hooks?: PluginHooks
}
