// API Types

export interface StoryMeta {
  id: string
  name: string
  description: string
  summary: string
  createdAt: string
  updatedAt: string
  settings: {
    outputFormat: 'plaintext' | 'markdown'
    enabledPlugins: string[]
    summarizationThreshold?: number
    maxSteps?: number
    providerId?: string | null
    modelId?: string | null
    librarianProviderId?: string | null
    librarianModelId?: string | null
    characterChatProviderId?: string | null
    characterChatModelId?: string | null
    proseTransformProviderId?: string | null
    proseTransformModelId?: string | null
    librarianChatProviderId?: string | null
    librarianChatModelId?: string | null
    librarianRefineProviderId?: string | null
    librarianRefineModelId?: string | null
    autoApplyLibrarianSuggestions?: boolean
    contextOrderMode?: 'simple' | 'advanced'
    fragmentOrder?: string[]
    enabledBuiltinTools?: string[]
    contextCompact?: { type: 'proseLimit' | 'maxTokens' | 'maxCharacters'; value: number }
    summaryCompact?: { maxCharacters: number; targetCharacters: number }
    enableHierarchicalSummary?: boolean
  }
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
  archived: boolean
  version?: number
  versions?: FragmentVersion[]
}

export interface FragmentVersion {
  version: number
  name: string
  description: string
  content: string
  createdAt: string
  reason?: string
}

export interface FragmentTypeInfo {
  type: string
  prefix: string
  stickyByDefault: boolean
}

export interface GenerationLogSummary {
  id: string
  createdAt: string
  input: string
  fragmentId: string | null
  model: string
  durationMs: number
  toolCallCount: number
  stepCount: number
  stepsExceeded: boolean
}

export interface LibrarianAnalysisSummary {
  id: string
  createdAt: string
  fragmentId: string
  contradictionCount: number
  suggestionCount: number
  pendingSuggestionCount: number
  timelineEventCount: number
  hasTrace?: boolean
}

export interface LibrarianAnalysis {
  id: string
  createdAt: string
  fragmentId: string
  summaryUpdate: string
  structuredSummary?: {
    events: string[]
    stateChanges: string[]
    openThreads: string[]
  }
  mentionedCharacters: string[]
  mentions?: Array<{ characterId: string; text: string }>
  contradictions: Array<{
    description: string
    fragmentIds: string[]
  }>
  knowledgeSuggestions: Array<{
    type: 'character' | 'knowledge'
    targetFragmentId?: string
    name: string
    description: string
    content: string
    sourceFragmentId?: string
    accepted?: boolean
    autoApplied?: boolean
    createdFragmentId?: string
  }>
  timelineEvents: Array<{
    event: string
    position: 'before' | 'during' | 'after'
  }>
  trace?: Array<{
    type: string
    [key: string]: unknown
  }>
}

export interface LibrarianState {
  lastAnalyzedFragmentId: string | null
  recentMentions: Record<string, string[]>
  timeline: Array<{ event: string; fragmentId: string }>
  runStatus?: 'idle' | 'scheduled' | 'running' | 'error'
  pendingFragmentId?: string | null
  runningFragmentId?: string | null
  lastError?: string | null
  updatedAt?: string
}

export interface AgentTraceEntry {
  runId: string
  parentRunId: string | null
  rootRunId: string
  agentName: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: 'success' | 'error'
  error?: string
  output?: Record<string, unknown>
}

export interface AgentRunTraceRecord {
  rootRunId: string
  runId: string
  storyId: string
  agentName: string
  status: 'success' | 'error'
  startedAt: string
  finishedAt: string
  durationMs: number
  error?: string
  trace: AgentTraceEntry[]
}

export interface LibrarianAcceptSuggestionResponse {
  analysis: LibrarianAnalysis
  createdFragmentId: string | null
}

export interface ChatHistory {
  messages: Array<{ role: 'user' | 'assistant'; content: string; reasoning?: string }>
  updatedAt: string
}

export interface ProviderConfigSafe {
  id: string
  name: string
  preset: string
  baseURL: string
  apiKey: string // masked
  defaultModel: string
  enabled: boolean
  customHeaders?: Record<string, string>
  createdAt: string
}

export interface GlobalConfigSafe {
  providers: ProviderConfigSafe[]
  defaultProviderId: string | null
}

export interface ProseChainEntry {
  proseFragments: Array<{
    id: string
    type: string
    name: string
    description: string
    createdAt: string
    generationMode?: string
  }>
  active: string
}

export interface ProseChain {
  entries: ProseChainEntry[]
}

export interface GenerationLog {
  id: string
  createdAt: string
  input: string
  messages: Array<{ role: string; content: string }>
  toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>
  generatedText: string
  fragmentId: string | null
  model: string
  durationMs: number
  stepCount: number
  finishReason: string
  stepsExceeded: boolean
  totalUsage?: { inputTokens: number; outputTokens: number }
  reasoning?: string
}

export interface PluginManifestInfo {
  name: string
  version: string
  description: string
  panel?: {
    title: string
    mode?: 'react' | 'iframe'
    url?: string
    showInSidebar?: boolean
    icon?:
      | { type: 'lucide'; name: string }
      | { type: 'svg'; src: string }
  }
}

// Block Config types
export interface BlockOverride {
  enabled?: boolean
  order?: number
  contentMode?: 'override' | 'prepend' | 'append' | null
  customContent?: string
}

export interface CustomBlockDefinition {
  id: string
  name: string
  role: 'system' | 'user'
  order: number
  enabled: boolean
  type: 'simple' | 'script'
  content: string
}

export interface BlockConfig {
  customBlocks: CustomBlockDefinition[]
  overrides: Record<string, BlockOverride>
  blockOrder: string[]
}

export interface BuiltinBlockMeta {
  id: string
  role: 'system' | 'user'
  order: number
  source: string
  contentPreview: string
}

export interface BlocksResponse {
  config: BlockConfig
  builtinBlocks: BuiltinBlockMeta[]
}

export interface BlockPreviewResponse {
  messages: Array<{ role: string; content: string }>
  blocks: Array<{ id: string; name: string; role: string }>
  blockCount: number
}

// Branch types
export interface BranchMeta {
  id: string
  name: string
  order: number
  parentBranchId?: string
  forkAfterIndex?: number
  createdAt: string
}

export interface BranchesIndex {
  branches: BranchMeta[]
  activeBranchId: string
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; toolName: string; result: unknown }
  | { type: 'finish'; finishReason: string; stepCount: number }

// Character Chat types
export type PersonaMode =
  | { type: 'character'; characterId: string }
  | { type: 'stranger' }
  | { type: 'custom'; prompt: string }

export interface CharacterChatMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  createdAt: string
}

export interface CharacterChatConversation {
  id: string
  characterId: string
  persona: PersonaMode
  storyPointFragmentId: string | null
  title: string
  messages: CharacterChatMessage[]
  createdAt: string
  updatedAt: string
}

export interface CharacterChatConversationSummary {
  id: string
  characterId: string
  persona: PersonaMode
  storyPointFragmentId: string | null
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}
