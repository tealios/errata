import type { Elysia } from 'elysia'

export interface StorySettings {
  outputFormat: 'plaintext' | 'markdown'
  enabledPlugins: string[]
  summarizationThreshold: number
  maxSteps: number
  providerId: string | null
  modelId: string | null
  contextOrderMode: 'simple' | 'advanced'
  fragmentOrder: string[]
}

export interface StoryMeta {
  id: string
  name: string
  description: string
  summary: string
  createdAt: string
  updatedAt: string
  settings: StorySettings
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
  archived?: boolean
}

export interface ContextBuildState {
  story: StoryMeta
  proseFragments: Fragment[]
  stickyGuidelines: Fragment[]
  stickyKnowledge: Fragment[]
  stickyCharacters: Fragment[]
  guidelineShortlist: Fragment[]
  knowledgeShortlist: Fragment[]
  characterShortlist: Fragment[]
  authorInput: string
}

export interface ContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface PluginManifest {
  name: string
  version: string
  description: string
  panel?: {
    title: string
    mode?: 'react' | 'iframe'
    url?: string
  }
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

export interface FragmentTypeDefinition {
  type: string
  prefix: string
  stickyByDefault: boolean
  contextRenderer: (fragment: Fragment) => string
  shortlistFields: Array<'id' | 'name' | 'description'>
  llmTools?: boolean
}

export interface WritingPlugin {
  manifest: PluginManifest
  fragmentTypes?: FragmentTypeDefinition[]
  tools?: (dataDir: string, storyId: string) => Record<string, unknown>
  routes?: (app: Elysia) => Elysia
  hooks?: PluginHooks
}

export declare function definePlugin<T extends WritingPlugin>(plugin: T): T
export declare const createPlugin: typeof definePlugin
