import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { BlockOverride, CustomBlockDefinition } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  GripVertical,
  ChevronDown,
  Eye,
  Plus,
  Trash2,
  Check,
  Code2,
  FileText,
} from 'lucide-react'
import { BlockCreateDialog } from './BlockCreateDialog'
import { BlockPreviewDialog } from './BlockPreviewDialog'
import { cn } from '@/lib/utils'
import { useHelp } from '@/hooks/use-help'
import { componentId } from '@/lib/dom-ids'

interface BlockEditorPanelProps {
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

export function BlockEditorPanel({ storyId }: BlockEditorPanelProps) {
  const queryClient = useQueryClient()
  const { openHelp } = useHelp()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['blocks', storyId],
    queryFn: () => api.blocks.get(storyId),
  })

  const configMutation = useMutation({
    mutationFn: (params: { overrides?: Record<string, BlockOverride>; blockOrder?: string[] }) =>
      api.blocks.updateConfig(storyId, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocks', storyId] })
    },
  })

  const createMutation = useMutation({
    mutationFn: (block: CustomBlockDefinition) =>
      api.blocks.createCustom(storyId, block),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocks', storyId] })
    },
  })

  const updateCustomMutation = useMutation({
    mutationFn: ({ blockId, updates }: { blockId: string; updates: Partial<Omit<CustomBlockDefinition, 'id'>> }) =>
      api.blocks.updateCustom(storyId, blockId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocks', storyId] })
    },
  })

  const deleteCustomMutation = useMutation({
    mutationFn: (blockId: string) =>
      api.blocks.deleteCustom(storyId, blockId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocks', storyId] })
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

  // Detect role transitions for section labels
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
        <p className="mt-3 text-[11px] text-muted-foreground/55">Loading blocks...</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-xs text-muted-foreground/55 italic">Failed to load blocks</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full" data-component-id="block-editor-root">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-3">
        <p className="text-[11px] text-muted-foreground/50 leading-snug flex-1">
          Arrange and customize the model context pipeline.{' '}
          <button
            className="text-muted-foreground/70 underline underline-offset-2 hover:text-foreground/70 transition-colors"
            onClick={() => openHelp('blocks')}
            data-component-id="block-editor-help"
          >
            Learn more
          </button>
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 shrink-0"
          onClick={() => setShowPreview(true)}
          data-component-id="block-editor-preview"
        >
          <Eye className="size-3" />
          Preview
        </Button>
      </div>

      <ScrollArea className="flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block" data-component-id="block-editor-scroll">
        <div className="px-2 py-3 space-y-1">
          {mergedBlocks.map((block, index) => {
            const isExpanded = expandedId === block.id
            const isCustom = block.source === 'custom'
            const isScript = isCustom && block.customDef?.type === 'script'
            const showRoleLabel = roleTransitions.has(index)

            return (
              <div key={block.id}>
                {/* Role section label */}
                {showRoleLabel && (
                  <div className={cn("flex items-center gap-2 px-1", index > 0 && "mt-3 mb-1.5", index === 0 && "mb-1.5")}>
                    <div className="size-1 rounded-full bg-muted-foreground/50" />
                    <span className="text-[9px] text-muted-foreground/55 uppercase tracking-[0.15em] font-medium">
                      {block.role} messages
                    </span>
                    <div className="flex-1 h-px bg-border/20" />
                  </div>
                )}

                {/* Block card */}
                <div
                  className={cn(
                    "rounded-lg border border-border/30 transition-all duration-200",
                    !block.enabled && 'opacity-[0.35]',
                    isExpanded && 'bg-accent/15 border-border/50 shadow-sm',
                    isCustom && !isExpanded && 'border-dashed',
                  )}
                  data-component-id={componentId('block', block.id, 'card')}
                >
                  {/* Block header row */}
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
                    {/* Drag handle */}
                    <div
                      role="presentation"
                      className="shrink-0 cursor-grab opacity-0 group-hover:opacity-50 transition-opacity duration-150 -ml-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GripVertical className="size-3.5 text-muted-foreground" />
                    </div>

                    {/* Type icon for custom blocks */}
                    {isCustom && (
                      <div className="shrink-0">
                        {isScript ? (
                          <Code2 className="size-3.5 text-amber-500/60" />
                        ) : (
                          <FileText className="size-3.5 text-muted-foreground/55" />
                        )}
                      </div>
                    )}

                    {/* Name + content preview */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate leading-tight">{block.name}</p>
                      {!isExpanded && block.contentPreview && (
                        <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5 leading-snug">
                          {block.contentPreview.slice(0, 80)}
                        </p>
                      )}
                    </div>

                    {/* Role badge */}
                    <Badge
                      variant="outline"
                      className="text-[9px] h-4 px-1.5 shrink-0 font-normal border-transparent text-muted-foreground/50 bg-muted/30"
                    >
                      {block.role === 'system' ? 'sys' : 'usr'}
                    </Badge>

                    {/* Enable/disable toggle */}
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
                      data-component-id={componentId('block', block.id, 'toggle')}
                    >
                      {block.enabled && <Check className="size-2.5" strokeWidth={3} />}
                    </button>

                    {/* Expand chevron */}
                    <ChevronDown
                      className={cn(
                        'size-3.5 text-muted-foreground/40 shrink-0 transition-transform duration-200',
                        isExpanded && 'rotate-180 text-muted-foreground/50',
                      )}
                    />
                  </div>

                  {/* Expandable content */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/20">
                        {isCustom && block.customDef ? (
                          <>
                            {/* Custom block type badge */}
                            <div className="flex items-center gap-2 pt-2">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-[10px] h-5 px-2 font-normal',
                                  isScript
                                    ? 'text-amber-500/70 border-amber-500/15 bg-amber-500/5'
                                    : 'text-muted-foreground/50 bg-muted/20',
                                )}
                              >
                                {isScript ? 'JavaScript' : 'Plain text'}
                              </Badge>
                            </div>

                            {/* Content editor */}
                            <BlurSaveTextarea
                              value={block.customDef.content}
                              onSave={(val) => {
                                updateCustomMutation.mutate({
                                  blockId: block.id,
                                  updates: { content: val },
                                })
                              }}
                              className={cn(
                                'text-xs min-h-[80px] resize-y border-border/30 focus:border-border/60',
                                isScript && 'font-mono bg-muted/20',
                              )}
                              rows={4}
                              placeholder={isScript ? 'return `...`' : 'Block content...'}
                              data-component-id={componentId('block', block.id, 'content')}
                            />

                            {/* Delete button */}
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs gap-1.5 text-destructive/60 hover:text-destructive hover:bg-destructive/5"
                                onClick={() => deleteCustomMutation.mutate(block.id)}
                                data-component-id={componentId('block', block.id, 'delete')}
                              >
                                <Trash2 className="size-3" />
                                Delete
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Builtin block: original content preview */}
                            <div className="pt-2">
                              <h4 className="text-[9px] text-muted-foreground/55 uppercase tracking-[0.15em] font-medium mb-1.5">
                                Original Content
                              </h4>
                              <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground/50 bg-muted/15 rounded-md p-3 max-h-[120px] overflow-y-auto border border-border/15 leading-relaxed">
                                {block.contentPreview}{block.contentPreview.length >= 200 ? '...' : ''}
                              </pre>
                            </div>

                            {/* Content mode pill selector */}
                            <div>
                              <h4 className="text-[9px] text-muted-foreground/55 uppercase tracking-[0.15em] font-medium mb-1.5">
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
                                          : 'text-muted-foreground/50 hover:text-muted-foreground/80',
                                      )}
                                      onClick={() => handleContentModeChange(block.id, mode)}
                                    >
                                      {label}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>

                            {/* Override content textarea */}
                            {block.override?.contentMode && (
                              <BlurSaveTextarea
                                value={block.override?.customContent ?? ''}
                                onSave={(val) => handleCustomContentChange(block.id, val)}
                                placeholder={`Content to ${block.override.contentMode}...`}
                                className="font-mono text-xs min-h-[60px] resize-y border-border/30 focus:border-border/60 bg-muted/10"
                                rows={3}
                                data-component-id={componentId('block', block.id, 'override')}
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
            className="w-full mt-3 py-3.5 rounded-lg border-2 border-dashed border-border/30 hover:border-primary/30 hover:bg-primary/[0.02] transition-all duration-200 flex items-center justify-center gap-2 text-[11px] text-muted-foreground/50 hover:text-primary/60 group"
            onClick={() => setShowCreateDialog(true)}
            data-component-id="block-editor-add"
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

      <BlockPreviewDialog
        storyId={storyId}
        open={showPreview}
        onOpenChange={setShowPreview}
      />
    </div>
  )
}
