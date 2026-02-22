import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { BlockOverride, CustomBlockDefinition, AgentBlockInfo } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  GripVertical,
  ChevronDown,
  ChevronLeft,
  Eye,
  Plus,
  Trash2,
  Check,
  Code2,
  FileText,
  Bot,
} from 'lucide-react'
import { BlockCreateDialog } from '@/components/blocks/BlockCreateDialog'
import { BlockContentView } from '@/components/blocks/BlockContentView'
import { ScriptBlockEditor, FragmentReference } from '@/components/blocks/ScriptBlockEditor'
import { ProviderSelect } from '@/components/settings/ProviderSelect'
import { ModelSelect } from '@/components/settings/ModelSelect'
import { resolveProvider, getInheritLabel } from '@/lib/model-role-helpers'
import { cn } from '@/lib/utils'

interface AgentContextPanelProps {
  storyId: string
}

type MergedBlock = {
  id: string
  name: string
  role: 'system' | 'user'
  order: number
  source: 'builtin' | 'custom'
  enabled: boolean
  contentPreview: string
  customDef?: CustomBlockDefinition
  override?: BlockOverride
}

function generateCustomBlockId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'cb-'
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function BlurSaveTextarea({
  value,
  onSave,
  ...props
}: { value: string; onSave: (value: string) => void } & Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'onBlur'>) {
  const [local, setLocal] = useState(value)
  const savedRef = useRef(value)

  useEffect(() => {
    setLocal(value)
    savedRef.current = value
  }, [value])

  return (
    <Textarea
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== savedRef.current) {
          onSave(local)
        }
      }}
      {...props}
    />
  )
}

const CONTENT_MODES = [
  { value: null, label: 'None' },
  { value: 'prepend' as const, label: 'Prepend' },
  { value: 'append' as const, label: 'Append' },
  { value: 'override' as const, label: 'Replace' },
]

/** Hierarchical agent groups in display order */
const AGENT_GROUPS: { label: string; prefix: string }[] = [
  { label: 'Generation', prefix: 'generation.' },
  { label: 'Directions', prefix: 'directions.' },
  { label: 'Librarian', prefix: 'librarian.' },
  { label: 'Character', prefix: 'character-chat.' },
]

/** Order within each group — agents not listed here sort to the end */
const AGENT_ORDER: string[] = [
  // Generation
  'generation.writer',
  'generation.prewriter',
  // Directions
  'directions.suggest',
  // Librarian
  'librarian.analyze',
  'librarian.chat',
  'librarian.refine',
  'librarian.optimize-character',
  'librarian.prose-transform',
  // Character
  'character-chat.chat',
]

function groupAgents(agents: AgentBlockInfo[]): { label: string; agents: AgentBlockInfo[] }[] {
  const agentMap = new Map(agents.map(a => [a.agentName, a]))
  const placed = new Set<string>()
  const groups: { label: string; agents: AgentBlockInfo[] }[] = []

  for (const group of AGENT_GROUPS) {
    // Get agents for this group in the defined order, then append any unordered ones
    const ordered = AGENT_ORDER
      .filter(name => name.startsWith(group.prefix) && agentMap.has(name))
      .map(name => agentMap.get(name)!)

    const unordered = agents
      .filter(a => a.agentName.startsWith(group.prefix) && !AGENT_ORDER.includes(a.agentName))

    const all = [...ordered, ...unordered]
    if (all.length === 0) continue
    for (const a of all) placed.add(a.agentName)
    groups.push({ label: group.label, agents: all })
  }

  // Catch-all for agents that don't match any group
  const remaining = agents.filter(a => !placed.has(a.agentName))
  if (remaining.length > 0) {
    groups.push({ label: 'Other', agents: remaining })
  }

  return groups
}

export function AgentContextPanel({ storyId }: AgentContextPanelProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  const { data: agents, isLoading } = useQuery({
    queryKey: ['agent-blocks'],
    queryFn: () => api.agentBlocks.list(),
  })

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="size-5 rounded-full border-2 border-muted-foreground/15 border-t-muted-foreground/50 animate-spin" />
        <p className="mt-3 text-[11px] text-muted-foreground">Loading agents...</p>
      </div>
    )
  }

  if (!agents || agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-xs text-muted-foreground italic">No agents registered</p>
      </div>
    )
  }

  if (selectedAgent) {
    return (
      <AgentBlockEditor
        storyId={storyId}
        agentName={selectedAgent}
        agents={agents}
        onBack={() => setSelectedAgent(null)}
      />
    )
  }

  const groups = groupAgents(agents)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 py-3 border-b border-border/30">
        <p className="text-[11px] text-muted-foreground leading-snug">
          Customize the context blocks, tools, and model for each agent.
        </p>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 py-3 space-y-4">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="flex items-center gap-2 px-1 mb-1.5">
                <div className="size-1 rounded-full bg-muted-foreground/50" />
                <span className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium">
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-border/20" />
              </div>
              <div className="space-y-1">
                {group.agents.map((agent) => (
                  <button
                    key={agent.agentName}
                    className="w-full rounded-lg border border-border/30 hover:border-border/50 hover:bg-accent/10 transition-all duration-150 px-3 py-2.5 text-left group"
                    onClick={() => setSelectedAgent(agent.agentName)}
                  >
                    <div className="flex items-center gap-2.5">
                      <Bot className="size-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate leading-tight">{agent.displayName}</p>
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5 leading-snug">
                          {agent.description}
                        </p>
                      </div>
                      <ChevronDown className="size-3.5 text-muted-foreground shrink-0 -rotate-90 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// --- Agent Block Editor (for a specific agent) ---

interface AgentBlockEditorProps {
  storyId: string
  agentName: string
  agents: AgentBlockInfo[]
  onBack: () => void
}

function AgentBlockEditor({ storyId, agentName, agents, onBack }: AgentBlockEditorProps) {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [showModel, setShowModel] = useState(false)
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const agent = agents.find(a => a.agentName === agentName)

  const { data, isLoading } = useQuery({
    queryKey: ['agent-blocks', storyId, agentName],
    queryFn: () => api.agentBlocks.get(storyId, agentName),
  })

  const { data: previewData, isLoading: previewLoading } = useQuery({
    queryKey: ['agent-block-preview', storyId, agentName],
    queryFn: () => api.agentBlocks.preview(storyId, agentName),
    enabled: showPreview,
  })

  // Model selection queries
  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })

  const { data: globalConfig } = useQuery({
    queryKey: ['global-config'],
    queryFn: () => api.config.getProviders(),
  })

  const { data: modelRoles } = useQuery({
    queryKey: ['model-roles'],
    queryFn: () => api.agentBlocks.listModelRoles(),
  })

  const modelOverrideMutation = useMutation({
    mutationFn: (data: { modelOverrides: Record<string, { providerId?: string | null; modelId?: string | null }> }) =>
      api.settings.update(storyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
    },
  })

  const configMutation = useMutation({
    mutationFn: (params: { overrides?: Record<string, BlockOverride>; blockOrder?: string[]; disabledTools?: string[] }) =>
      api.agentBlocks.updateConfig(storyId, agentName, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-blocks', storyId, agentName] })
    },
  })

  const createMutation = useMutation({
    mutationFn: (block: CustomBlockDefinition) =>
      api.agentBlocks.createCustom(storyId, agentName, block),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-blocks', storyId, agentName] })
    },
  })

  const updateCustomMutation = useMutation({
    mutationFn: ({ blockId, updates }: { blockId: string; updates: Partial<Omit<CustomBlockDefinition, 'id'>> }) =>
      api.agentBlocks.updateCustom(storyId, agentName, blockId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-blocks', storyId, agentName] })
    },
  })

  const deleteCustomMutation = useMutation({
    mutationFn: (blockId: string) =>
      api.agentBlocks.deleteCustom(storyId, agentName, blockId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-blocks', storyId, agentName] })
    },
  })

  const mergedBlocks = useMemo((): MergedBlock[] => {
    if (!data) return []

    const { config, builtinBlocks } = data
    const blockOrder = config.blockOrder
    const orderMap = new Map(blockOrder.map((id, i) => [id, i]))

    const blocks: MergedBlock[] = []

    for (const b of builtinBlocks) {
      const override = config.overrides[b.id]
      blocks.push({
        id: b.id,
        name: b.id,
        role: b.role,
        order: orderMap.get(b.id) ?? b.order,
        source: 'builtin',
        enabled: override?.enabled !== false,
        contentPreview: b.contentPreview,
        override,
      })
    }

    for (const cb of config.customBlocks) {
      const override = config.overrides[cb.id]
      blocks.push({
        id: cb.id,
        name: cb.name,
        role: cb.role,
        order: orderMap.get(cb.id) ?? cb.order,
        source: 'custom',
        enabled: (override?.enabled !== false) && cb.enabled,
        contentPreview: cb.content.slice(0, 200),
        customDef: cb,
        override,
      })
    }

    blocks.sort((a, b) => {
      if (a.role !== b.role) return a.role === 'system' ? -1 : 1
      return a.order - b.order
    })

    return blocks
  }, [data])

  const disabledTools = useMemo(() => new Set(data?.config.disabledTools ?? []), [data])

  const handleToggleEnabled = useCallback((blockId: string, currentEnabled: boolean) => {
    configMutation.mutate({
      overrides: { [blockId]: { enabled: !currentEnabled } },
    })
  }, [configMutation])

  const handleContentModeChange = useCallback((blockId: string, mode: 'override' | 'prepend' | 'append' | null) => {
    configMutation.mutate({
      overrides: { [blockId]: { contentMode: mode } },
    })
  }, [configMutation])

  const handleCustomContentChange = useCallback((blockId: string, content: string) => {
    configMutation.mutate({
      overrides: { [blockId]: { customContent: content } },
    })
  }, [configMutation])

  const handleCreateBlock = useCallback((blockData: {
    name: string
    role: 'system' | 'user'
    type: 'simple' | 'script'
    content: string
  }) => {
    const maxOrder = mergedBlocks.reduce((max, b) => Math.max(max, b.order), 0)
    createMutation.mutate({
      id: generateCustomBlockId(),
      name: blockData.name,
      role: blockData.role,
      order: maxOrder + 100,
      enabled: true,
      type: blockData.type,
      content: blockData.content,
    })
  }, [createMutation, mergedBlocks])

  const handleToggleTool = useCallback((toolName: string) => {
    const newDisabled = disabledTools.has(toolName)
      ? [...disabledTools].filter(t => t !== toolName)
      : [...disabledTools, toolName]
    configMutation.mutate({ disabledTools: newDisabled })
  }, [configMutation, disabledTools])

  const handleDragStart = useCallback((index: number) => {
    dragItem.current = index
    setDragIndex(index)
  }, [])

  const handleDragEnter = useCallback((index: number) => {
    dragOverItem.current = index
  }, [])

  const handleDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current) {
      setDragIndex(null)
      return
    }

    const reordered = [...mergedBlocks]
    const [removed] = reordered.splice(dragItem.current, 1)
    reordered.splice(dragOverItem.current, 0, removed)

    const newOrder = reordered.map(b => b.id)
    configMutation.mutate({ blockOrder: newOrder })

    dragItem.current = null
    dragOverItem.current = null
    setDragIndex(null)
  }, [mergedBlocks, configMutation])

  const roleTransitions = useMemo(() => {
    const set = new Set<number>()
    for (let i = 0; i < mergedBlocks.length; i++) {
      if (i === 0 || mergedBlocks[i].role !== mergedBlocks[i - 1].role) {
        set.add(i)
      }
    }
    return set
  }, [mergedBlocks])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="size-5 rounded-full border-2 border-muted-foreground/15 border-t-muted-foreground/50 animate-spin" />
        <p className="mt-3 text-[11px] text-muted-foreground">Loading agent blocks...</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-xs text-muted-foreground italic">Failed to load agent blocks</p>
      </div>
    )
  }

  const availableTools = data.availableTools ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header with back button */}
      <div className="px-3 py-2.5 border-b border-border/30 flex items-center gap-2">
        <button
          className="shrink-0 size-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-all"
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium truncate">{agent?.displayName ?? agentName}</p>
          <p className="text-[10px] text-muted-foreground truncate">{agent?.description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 shrink-0"
          onClick={() => setShowPreview(true)}
        >
          <Eye className="size-3" />
          Preview
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]>div]:!block">
        <div className="px-2 py-3 space-y-1">
          {/* Model selection section */}
          {agent && story && (() => {
            const overrideKey = agent.agentName
            const roles = modelRoles ?? []
            const overrides = story.settings.modelOverrides ?? {}
            const directProviderId = overrides[overrideKey]?.providerId ?? null
            const directModelId = overrides[overrideKey]?.modelId ?? null
            const effectiveProviderId = resolveProvider(overrideKey, story.settings, globalConfig ?? null)
            const isGeneration = overrideKey === 'generation'

            return (
              <div className="mb-3">
                <button
                  className="flex items-center gap-2 px-1 mb-1.5 w-full"
                  onClick={() => setShowModel(!showModel)}
                >
                  <div className="size-1 rounded-full bg-muted-foreground/50" />
                  <span className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium">
                    Model
                  </span>
                  <div className="flex-1 h-px bg-border/20" />
                  <ChevronDown className={cn(
                    'size-3 text-muted-foreground transition-transform duration-150',
                    showModel && 'rotate-180',
                  )} />
                </button>

                {showModel && (
                  <div className="px-1 py-1.5 space-y-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground mb-1 block">Provider</label>
                      <ProviderSelect
                        value={directProviderId}
                        globalConfig={globalConfig ?? null}
                        onChange={(id) => {
                          modelOverrideMutation.mutate({
                            modelOverrides: { ...overrides, [overrideKey]: { providerId: id, modelId: null } },
                          })
                        }}
                        disabled={modelOverrideMutation.isPending}
                        inheritLabel={isGeneration ? undefined : getInheritLabel(overrideKey, roles, story.settings, globalConfig ?? null)}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground mb-1 block">Model</label>
                      <ModelSelect
                        providerId={effectiveProviderId}
                        value={directModelId}
                        onChange={(mid) => {
                          modelOverrideMutation.mutate({
                            modelOverrides: { ...overrides, [overrideKey]: { ...overrides[overrideKey], modelId: mid } },
                          })
                        }}
                        disabled={modelOverrideMutation.isPending}
                        defaultLabel={isGeneration ? 'Default' : 'Inherit'}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Tool toggles section */}
          {availableTools.length > 0 && (
            <div className="mb-3">
              <button
                className="flex items-center gap-2 px-1 mb-1.5 w-full"
                onClick={() => setShowTools(!showTools)}
              >
                <div className="size-1 rounded-full bg-muted-foreground/50" />
                <span className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium">
                  Tools ({availableTools.length - disabledTools.size}/{availableTools.length})
                </span>
                <div className="flex-1 h-px bg-border/20" />
                <ChevronDown className={cn(
                  'size-3 text-muted-foreground transition-transform duration-150',
                  showTools && 'rotate-180',
                )} />
              </button>

              {showTools && (
                <div className="px-1 py-1.5 space-y-0.5">
                  {availableTools.map((toolName) => {
                    const enabled = !disabledTools.has(toolName)
                    return (
                      <div
                        key={toolName}
                        className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent/10 transition-colors"
                      >
                        <button
                          className={cn(
                            'shrink-0 size-[16px] rounded-full border-[1.5px] flex items-center justify-center transition-all duration-200',
                            enabled
                              ? 'border-emerald-500/80 bg-emerald-500 text-white shadow-[0_0_4px_rgba(16,185,129,0.15)]'
                              : 'border-muted-foreground/30 bg-transparent hover:border-muted-foreground/50',
                          )}
                          onClick={() => handleToggleTool(toolName)}
                        >
                          {enabled && <Check className="size-2" strokeWidth={3} />}
                        </button>
                        <span className={cn(
                          'text-[11px] font-mono truncate',
                          !enabled && 'text-muted-foreground line-through',
                        )}>
                          {toolName}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Blocks */}
          {mergedBlocks.map((block, index) => {
            const isExpanded = expandedId === block.id
            const isCustom = block.source === 'custom'
            const isScript = isCustom && block.customDef?.type === 'script'
            const showRoleLabel = roleTransitions.has(index)

            return (
              <div key={block.id}>
                {showRoleLabel && (
                  <div className={cn("flex items-center gap-2 px-1", index > 0 && "mt-3 mb-1.5", index === 0 && "mb-1.5")}>
                    <div className="size-1 rounded-full bg-muted-foreground/50" />
                    <span className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium">
                      {block.role} messages
                    </span>
                    <div className="flex-1 h-px bg-border/20" />
                  </div>
                )}

                <div
                  className={cn(
                    "rounded-lg border border-border/30 transition-all duration-200",
                    !block.enabled && 'opacity-[0.35]',
                    isExpanded && 'bg-accent/15 border-border/50 shadow-sm',
                    isCustom && !isExpanded && 'border-dashed',
                  )}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragEnter={() => handleDragEnter(index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => e.preventDefault()}
                    className={cn(
                      'group flex items-center gap-2 px-2.5 py-2 cursor-pointer select-none transition-all duration-150',
                      dragIndex === index && 'opacity-40 scale-[0.97]',
                    )}
                    onClick={() => setExpandedId(isExpanded ? null : block.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : block.id) } }}
                  >
                    <div
                      role="presentation"
                      className="shrink-0 cursor-grab opacity-0 group-hover:opacity-50 transition-opacity duration-150 -ml-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GripVertical className="size-3.5 text-muted-foreground" />
                    </div>

                    {isCustom && (
                      <div className="shrink-0">
                        {isScript ? (
                          <Code2 className="size-3.5 text-amber-500/60" />
                        ) : (
                          <FileText className="size-3.5 text-muted-foreground" />
                        )}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate leading-tight">{block.name}</p>
                      {!isExpanded && block.contentPreview && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5 leading-snug">
                          {block.contentPreview.slice(0, 80)}
                        </p>
                      )}
                    </div>

                    <Badge
                      variant="outline"
                      className="text-[9px] h-4 px-1.5 shrink-0 font-normal border-transparent text-muted-foreground bg-muted/30"
                    >
                      {block.role === 'system' ? 'sys' : 'usr'}
                    </Badge>

                    <button
                      className={cn(
                        'shrink-0 size-[18px] rounded-full border-[1.5px] flex items-center justify-center transition-all duration-200',
                        block.enabled
                          ? 'border-emerald-500/80 bg-emerald-500 text-white shadow-[0_0_6px_rgba(16,185,129,0.2)]'
                          : 'border-muted-foreground/30 bg-transparent hover:border-muted-foreground/50',
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleEnabled(block.id, block.enabled)
                      }}
                      title={block.enabled ? 'Disable block' : 'Enable block'}
                    >
                      {block.enabled && <Check className="size-2.5" strokeWidth={3} />}
                    </button>

                    <ChevronDown
                      className={cn(
                        'size-3.5 text-muted-foreground shrink-0 transition-transform duration-200',
                        isExpanded && 'rotate-180',
                      )}
                    />
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/20">
                      {isCustom && block.customDef ? (
                        <>
                          <div className="flex items-center gap-2 pt-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] h-5 px-2 font-normal',
                                isScript
                                  ? 'text-amber-500/70 border-amber-500/15 bg-amber-500/5'
                                  : 'text-muted-foreground bg-muted/20',
                              )}
                            >
                              {isScript ? 'JavaScript' : 'Plain text'}
                            </Badge>
                          </div>

                          {isScript ? (
                            <>
                              <ScriptBlockEditor
                                storyId={storyId}
                                blockId={block.id}
                                value={block.customDef.content}
                                onSave={(val) => {
                                  updateCustomMutation.mutate({
                                    blockId: block.id,
                                    updates: { content: val },
                                  })
                                }}
                              />
                              <FragmentReference storyId={storyId} />
                            </>
                          ) : (
                            <BlurSaveTextarea
                              value={block.customDef.content}
                              onSave={(val) => {
                                updateCustomMutation.mutate({
                                  blockId: block.id,
                                  updates: { content: val },
                                })
                              }}
                              className="text-xs min-h-[80px] resize-y border-border/30 focus:border-border/60"
                              rows={4}
                              placeholder="Block content..."
                            />
                          )}

                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1.5 text-destructive/60 hover:text-destructive hover:bg-destructive/5"
                              onClick={() => deleteCustomMutation.mutate(block.id)}
                            >
                              <Trash2 className="size-3" />
                              Delete
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="pt-2">
                            <h4 className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium mb-1.5">
                              Original Content
                            </h4>
                            <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground bg-muted/15 rounded-md p-3 max-h-[120px] overflow-y-auto border border-border/15 leading-relaxed">
                              {block.contentPreview}{block.contentPreview.length >= 200 ? '...' : ''}
                            </pre>
                          </div>

                          <div>
                            <h4 className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium mb-1.5">
                              Modify
                            </h4>
                            <div className="flex rounded-lg bg-muted/25 p-[3px] gap-[3px]">
                              {CONTENT_MODES.map(({ value: mode, label }) => {
                                const isActive = (block.override?.contentMode ?? null) === mode
                                return (
                                  <button
                                    key={label}
                                    className={cn(
                                      'flex-1 px-1 py-[5px] rounded-md text-[10px] font-medium transition-all duration-150',
                                      isActive
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-muted-foreground',
                                    )}
                                    onClick={() => handleContentModeChange(block.id, mode)}
                                  >
                                    {label}
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {block.override?.contentMode && (
                            <BlurSaveTextarea
                              value={block.override?.customContent ?? ''}
                              onSave={(val) => handleCustomContentChange(block.id, val)}
                              placeholder={`Content to ${block.override.contentMode}...`}
                              className="font-mono text-xs min-h-[60px] resize-y border-border/30 focus:border-border/60 bg-muted/10"
                              rows={3}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Add custom block */}
          <button
            className="w-full mt-3 py-3.5 rounded-lg border-2 border-dashed border-border/30 hover:border-primary/30 hover:bg-primary/[0.02] transition-all duration-200 flex items-center justify-center gap-2 text-[11px] text-muted-foreground hover:text-primary/60 group"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus className="size-3.5 transition-transform duration-200 group-hover:scale-110" />
            <span className="font-medium">Add Custom Block</span>
          </button>
        </div>
      </ScrollArea>

      <BlockCreateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={handleCreateBlock}
      />

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="sm:max-w-[900px] max-h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="font-display text-lg flex items-center gap-2.5">
              {agent?.displayName ?? agentName} — Context Preview
              {previewData && (
                <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                  {previewData.blockCount} {previewData.blockCount === 1 ? 'block' : 'blocks'}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {previewLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="size-5 rounded-full border-2 border-muted-foreground/15 border-t-muted-foreground/50 animate-spin" />
              <p className="mt-3 text-[11px] text-muted-foreground">Compiling context...</p>
            </div>
          ) : previewData?.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-xs text-muted-foreground italic">No messages in context</p>
            </div>
          ) : previewData ? (
            <BlockContentView
              messages={previewData.messages}
              blocks={previewData.blocks}
              className="border-t border-border/30"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
