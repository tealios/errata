// API Types

export interface CustomFragmentType {
  type: string
  name: string
  description: string
  icon: string
  showInSidebar: boolean
}

export interface StoryMeta {
  id: string
  name: string
  description: string
  coverImage: string | null
  /**
   * @deprecated DEPRECATED (summary-fragments migration). Rolling summaries
   * now live in fragments of type 'summary'. This field is cleared by
   * the server-side migration on first load and is no longer written
   * anywhere. Kept so existing payloads parse. Safe to drop once the
   * server-side schema removes it.
   */
  summary: string
  createdAt: string
  updatedAt: string
  settings: {
    outputFormat: 'plaintext' | 'markdown'
    enabledPlugins: string[]
    summarizationThreshold?: number
    maxSteps?: number
    modelOverrides?: Record<string, { providerId?: string | null; modelId?: string | null; temperature?: number | null }>
    // Legacy fields (backward compat)
    providerId?: string | null
    modelId?: string | null
    generationMode?: 'standard' | 'prewriter'
    /** Prewriter asks clarifying questions before writing. Only active in prewriter mode. */
    clarifyBeforeGenerate?: boolean
    /** How much the prewriter deliberates. Only active in prewriter mode. */
    prewriterReasoning?: 'short' | 'normal' | 'extensive'
    disableLibrarianAutoAnalysis?: boolean
    autoApplyLibrarianSuggestions?: boolean
    disableLibrarianDirections?: boolean
    disableLibrarianSuggestions?: boolean
    contextOrderMode?: 'simple' | 'advanced'
    fragmentOrder?: string[]
    customFragmentTypes?: CustomFragmentType[]
    contextCompact?: { type: 'proseLimit' | 'maxTokens' | 'maxCharacters'; value: number }
    /**
     * @deprecated DEPRECATED (summary-fragments migration). Drove the old
     * LLM-backed story.summary compactor. Per-fragment overflow now uses
     * a constant threshold in the librarian. Setting is ignored.
     */
    summaryCompact?: { maxCharacters: number; targetCharacters: number }
    enableHierarchicalSummary?: boolean
    guidedContinuePrompt?: string
    guidedSceneSettingPrompt?: string
    guidedSuggestPrompt?: string
    disableThinking?: boolean
    expandThoughtsByDefault?: boolean
    /** erratanet provenance: installed-from pack and/or where this story is published. */
    erratanet?: {
      pack?: string
      version?: string
      publishedAs?: { pack: string; version: string }
      /** Fragment packs published from this story (e.g. a reusable "starter"). */
      fragmentPacks?: { pack: string; version: string; fragmentIds: string[] }[]
      /** Agent-config packs shared from this story, re-syncable as new versions. */
      agentConfigs?: { pack: string; version: string; includes: string[] }[]
    }
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

export interface FrozenSection {
  id: string
  text: string
}

export interface Folder {
  id: string
  name: string
  order: number
  color?: string
}

/** Fragment ID → Folder ID */
export type FolderAssignments = Record<string, string>

export interface FoldersResponse {
  folders: Folder[]
  assignments: FolderAssignments
}

export interface FragmentTypeInfo {
  type: string
  prefix: string
  stickyByDefault: boolean
  name?: string
  description?: string
  icon?: string
  custom?: boolean
  showInSidebar?: boolean
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
  directionsCount: number
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
  fragmentSuggestions: Array<{
    type: 'character' | 'knowledge'
    targetFragmentId?: string
    name: string
    description: string
    content: string
    sourceFragmentId?: string
    accepted?: boolean
    autoApplied?: boolean
    createdFragmentId?: string
    dismissed?: boolean
  }>
  timelineEvents: Array<{
    event: string
    position: 'before' | 'during' | 'after'
  }>
  directions?: SuggestionDirection[]
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
  input?: Record<string, unknown>
  output?: Record<string, unknown>
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

export interface ConversationMeta {
  id: string
  title: string
  createdAt: string
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
  temperature?: number
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
  prewriterBrief?: string
  prewriterReasoning?: string
  prewriterMessages?: Array<{ role: string; content: string }>
  prewriterDurationMs?: number
  prewriterModel?: string
  prewriterUsage?: { inputTokens: number; outputTokens: number }
  prewriterDirections?: Array<{ pacing: string; title: string; description: string; instruction: string }>
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
  content: string
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

// Agent Block types
export interface ModelRoleInfo {
  key: string
  label: string
  description: string
}

export interface AgentBlockInfo {
  agentName: string
  displayName: string
  description: string
  availableTools: string[]
}

export interface AgentBlockConfig extends BlockConfig {
  disabledTools: string[]
  disableAutoAnalysis?: boolean
}

export interface AgentBlocksResponse {
  config: AgentBlockConfig
  builtinBlocks: BuiltinBlockMeta[]
  availableTools: string[]
}

export interface ExportedAgentConfig {
  agentName: string
  displayName: string
  config: AgentBlockConfig
}

// Config export/import types
export interface ExportedConfigs {
  blockConfig?: BlockConfig
  agentBlockConfigs?: Record<string, AgentBlockConfig>
}

export interface ImportConfigsPayload {
  blockConfig?: BlockConfig
  agentBlockConfigs?: Record<string, AgentBlockConfig>
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

export interface SuggestionDirection {
  title: string
  description: string
  instruction: string
  pacing?: 'linger' | 'continue' | 'end'
}

/** A single option offered for a clarifying question (mirrors AskUserQuestion). */
export interface ClarifyQuestionOption {
  label: string
  description?: string
}

/** A clarifying question the prewriter can ask the author before writing. */
export interface ClarifyQuestion {
  question: string
  /** Short chip label (<= 12 chars). */
  header: string
  multiSelect: boolean
  /** 2-4 suggested options, or omitted/empty for a free-text question. */
  options?: ClarifyQuestionOption[]
}

/** An answered clarifying question, carried back into the next generate request. */
export interface Clarification {
  question: string
  answer: string
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'prewriter-text'; text: string }
  | { type: 'prewriter-reset' }
  | { type: 'tool-call'; id: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; toolName: string; result: unknown }
  | { type: 'phase'; phase: string }
  | { type: 'finish'; finishReason: string; stepCount: number }
  | { type: 'prewriter-directions'; directions: SuggestionDirection[] }
  | { type: 'clarify-questions'; questions: ClarifyQuestion[]; round: number }

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

// Network sharing (Basic Auth + LAN + cloudflared tunnel)
export type TunnelStatus = 'stopped' | 'downloading' | 'starting' | 'running' | 'error'

export interface SharingStatusResponse {
  authEnabled: boolean
  hasPassword: boolean
  username: string
  lan: { enabled: boolean; running: boolean; url: string | null }
  tunnel: { enabled: boolean; status: TunnelStatus; url: string | null; error: string | null }
  lanQr: string | null
  tunnelQr: string | null
}

// Erratanet (pack hub) — config, account, search, packs

/** Safe view of the erratanet config (token is redacted server-side). */
export interface ErratanetConfigResponse {
  hubUrl: string
  /** Redacted to a fixed mask when present, empty string when signed out. */
  token: string
  handle?: string
  /** ErrataNet is hidden in the UI until enabled. */
  enabled: boolean
  /** Whether the first-run intro prompt has been shown. */
  introSeen: boolean
}

/** Resolved account for the configured hub token. */
export interface ErratanetAccount {
  connected: boolean
  handle?: string
  displayName?: string
  hubUrl?: string
  /** Set when the hub was unreachable or the token was rejected. */
  error?: string
}

/** Which config surfaces an agent-config pack bundles. */
export type AgentConfigInclude = 'agent-blocks' | 'provider-shape' | 'model-roles'

/** Manifest-level discovery summary for an agent-config pack. */
export interface AgentConfigSummary {
  agents: string[]
  blockCount: number
  hasScripts: boolean
  includes: AgentConfigInclude[]
}

/** A pack as it appears in search results / listings. */
export interface ErratanetPackSummary {
  id: string
  version: string
  title: string
  description: string
  contentKind: 'fragment-pack' | 'story' | 'agent-config'
  fragmentTypes: string[]
  fragmentCount: number
  tags: string[]
  nsfw: boolean
  thumbnail?: string
  publisher?: string
  createdAt: string
  /** Present only for the `agent-config` kind. */
  agentConfig?: AgentConfigSummary
  /** Declared capabilities; `scripts` means the pack runs code. */
  capabilities?: string[]
}

export interface ErratanetSearchResponse {
  results: ErratanetPackSummary[]
}

/** Full pack record returned when fetching a single pack by id. */
export interface ErratanetPackDetail extends ErratanetPackSummary {
  license: string
  errataFormatVersion: number
  payloadHash: string
  /** Versions available for this pack, newest first. */
  versions?: string[]
}

export interface ErratanetPublishResponse {
  id: string
  version: string
}

export interface ErratanetInstallResponse {
  /** Story the pack was installed into (existing or newly created). */
  storyId: string
  /** Number of fragments created by the install. */
  fragmentCount: number
  /** True when install created a new story. */
  createdStory: boolean
}

/** A pack already installed in a story that has a newer version on the hub. */
export interface ErratanetUpdateInfo {
  id: string
  installedVersion: string
  latestVersion: string
}

export interface ErratanetUpdatesResponse {
  updates: ErratanetUpdateInfo[]
}

// --- Agent-config sharing (the `agent-config` pack kind) ---

export interface AgentConfigPreviewAgent {
  name: string
  displayName: string
  blocks: { id: string; name: string; role: 'system' | 'user'; type: 'simple' | 'script'; enabled: boolean }[]
  overrideCount: number
  disabledTools: string[]
}

/**
 * A precise pick of what to publish/apply, down to individual blocks. Each field
 * is a whitelist; an absent/empty field excludes that surface. `agentBlocks` maps
 * an agent name to the block ids to keep (the key's presence includes the agent).
 */
export interface AgentConfigSelection {
  agentBlocks?: Record<string, string[]>
  providerShapes?: string[]
  modelRoles?: string[]
}

export interface AgentConfigProviderShape {
  name: string
  preset: string
  baseURL: string
  defaultModel: string
  temperature?: number | null
}

export interface AgentConfigModelRole {
  role: string
  providerName?: string | null
  model?: string | null
  temperature?: number | null
}

/** Inspectable, side-effect-free view of a config (incl. verbatim script source). */
export interface AgentConfigPreview {
  agents: AgentConfigPreviewAgent[]
  providerShapes: AgentConfigProviderShape[]
  modelRoles: AgentConfigModelRole[]
  scripts: { agent: string; blockId: string; blockName: string; content: string }[]
  hasScripts: boolean
}

/** Snapshot of the current story's config, for the publish dialog. */
export interface AgentConfigSnapshotResponse {
  bundle: unknown
  summary: AgentConfigSummary
  preview: AgentConfigPreview
  error?: string
}

/** Inspection of a remote pack before installing. */
export interface AgentConfigInspectResponse {
  manifest: {
    id: string
    version: string
    title: string
    description: string
    license: string
    tags: string[]
    publisher?: string
    createdAt: string
    agentConfig?: AgentConfigSummary
  }
  summary: AgentConfigSummary
  preview: AgentConfigPreview
  requiresConsent: boolean
  error?: string
}

/** What an apply actually changed in the target story. */
export interface AgentConfigApplyResult {
  agentsApplied: string[]
  modelRolesApplied: string[]
  modelRolesNeedingProvider: string[]
  suggestedProviders: AgentConfigProviderShape[]
}

export interface AgentConfigApplyResponse {
  applied?: AgentConfigApplyResult
  presetId?: string
  requiresConsent?: boolean
  error?: string
}

/** A saved, story-independent preset (list view: no bundle). */
export interface AgentPresetSummary {
  id: string
  name: string
  createdAt: string
  source?: { pack: string; version: string }
  summary: AgentConfigSummary
}

export interface AgentPresetListResponse {
  presets: AgentPresetSummary[]
}

export interface AgentPresetDetailResponse {
  preset: AgentPresetSummary
  preview: AgentConfigPreview
  requiresConsent: boolean
  error?: string
}
