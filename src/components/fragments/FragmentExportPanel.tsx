import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { resolveFragmentVisual, generateBubbles, hexagonPoints, diamondPoints, type Bubble } from '@/lib/fragment-visuals'
import { serializeFragment, serializeBundle, downloadExportFile } from '@/lib/fragment-clipboard'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  X,
  Download,
  Clipboard,
  Check,
  BookOpen,
  Users,
  Database,
  Package,
  Settings2,
} from 'lucide-react'

interface FragmentExportPanelProps {
  storyId: string
  storyName?: string
  onClose: () => void
}

const TYPE_CONFIG: Record<string, { label: string; icon: typeof BookOpen }> = {
  guideline: { label: 'Guidelines', icon: BookOpen },
  character: { label: 'Characters', icon: Users },
  knowledge: { label: 'Knowledge', icon: Database },
}

const EXPORTABLE_TYPES = ['guideline', 'character', 'knowledge']

function BubbleSvgShape({ b }: { b: Bubble; i: number }) {
  const transform = b.shape !== 'circle' ? `rotate(${b.rotation} ${b.cx} ${b.cy})` : undefined
  switch (b.shape) {
    case 'rounded-rect':
      return <rect key={`${b.cx}-${b.cy}`} x={b.cx - b.r * 0.8} y={b.cy - b.r * 0.6} width={b.r * 1.6} height={b.r * 1.2} rx={b.r * 0.2} fill={b.color} opacity={b.opacity} transform={transform} />
    case 'hexagon':
      return <polygon key={`${b.cx}-${b.cy}`} points={hexagonPoints(b.cx, b.cy, b.r)} fill={b.color} opacity={b.opacity} transform={transform} />
    case 'ellipse':
      return <ellipse key={`${b.cx}-${b.cy}`} cx={b.cx} cy={b.cy} rx={b.r * 1.2} ry={b.r * 0.7} fill={b.color} opacity={b.opacity} transform={transform} />
    case 'diamond':
      return <polygon key={`${b.cx}-${b.cy}`} points={diamondPoints(b.cx, b.cy, b.r)} fill={b.color} opacity={b.opacity} transform={transform} />
    default:
      return <circle key={`${b.cx}-${b.cy}`} cx={b.cx} cy={b.cy} r={b.r} fill={b.color} opacity={b.opacity} />
  }
}

export function FragmentExportPanel({ storyId, storyName, onClose }: FragmentExportPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const [includeConfigs, setIncludeConfigs] = useState(false)

  const { data: allFragments } = useQuery({
    queryKey: ['fragments', storyId],
    queryFn: () => api.fragments.list(storyId),
  })

  const { data: exportedConfigs } = useQuery({
    queryKey: ['blocks', storyId, 'export-configs'],
    queryFn: () => api.blocks.exportConfigs(storyId),
    enabled: includeConfigs,
  })

  const configSummary = useMemo(() => {
    if (!exportedConfigs) return null
    const customBlockCount = exportedConfigs.blockConfig?.customBlocks.length ?? 0
    const overrideCount = Object.keys(exportedConfigs.blockConfig?.overrides ?? {}).length
    const agentCount = Object.keys(exportedConfigs.agentBlockConfigs ?? {}).length
    const hasBlockConfig = customBlockCount > 0 || overrideCount > 0
    if (!hasBlockConfig && agentCount === 0) return null
    return { customBlockCount, overrideCount, agentCount, hasBlockConfig }
  }, [exportedConfigs])

  const { data: imageFragments } = useQuery({
    queryKey: ['fragments', storyId, 'image'],
    queryFn: () => api.fragments.list(storyId, 'image'),
  })

  const { data: iconFragments } = useQuery({
    queryKey: ['fragments', storyId, 'icon'],
    queryFn: () => api.fragments.list(storyId, 'icon'),
  })

  const mediaById = useMemo(() => {
    const map = new Map<string, Fragment>()
    for (const f of imageFragments ?? []) map.set(f.id, f)
    for (const f of iconFragments ?? []) map.set(f.id, f)
    return map
  }, [imageFragments, iconFragments])

  const grouped = useMemo(() => {
    if (!allFragments) return {}
    const groups: Record<string, Fragment[]> = {}
    for (const type of EXPORTABLE_TYPES) {
      const list = allFragments
        .filter((f) => f.type === type && !f.archived)
        .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
      if (list.length > 0) groups[type] = list
    }
    return groups
  }, [allFragments])

  const allExportable = useMemo(() => {
    return Object.values(grouped).flat()
  }, [grouped])

  const toggleFragment = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleGroup = useCallback((type: string) => {
    const group = grouped[type]
    if (!group) return
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = group.every((f) => prev.has(f.id))
      if (allSelected) {
        for (const f of group) next.delete(f.id)
      } else {
        for (const f of group) next.add(f.id)
      }
      return next
    })
  }, [grouped])

  const selectAll = useCallback(() => {
    setSelected(new Set(allExportable.map((f) => f.id)))
  }, [allExportable])

  const deselectAll = useCallback(() => {
    setSelected(new Set())
  }, [])

  const selectedFragments = useMemo(() => {
    return allExportable.filter((f) => selected.has(f.id))
  }, [allExportable, selected])

  const bundleConfigs = useMemo(() => {
    if (!includeConfigs || !exportedConfigs) return undefined
    const hasBlock = !!exportedConfigs.blockConfig
    const hasAgent = !!exportedConfigs.agentBlockConfigs && Object.keys(exportedConfigs.agentBlockConfigs).length > 0
    if (!hasBlock && !hasAgent) return undefined
    return {
      blockConfig: exportedConfigs.blockConfig,
      agentBlockConfigs: exportedConfigs.agentBlockConfigs,
    }
  }, [includeConfigs, exportedConfigs])

  const handleDownload = useCallback(() => {
    if (selectedFragments.length === 0) return

    if (selectedFragments.length === 1 && !bundleConfigs) {
      const json = serializeFragment(selectedFragments[0], mediaById)
      const safeName = selectedFragments[0].name.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40)
      downloadExportFile(json, `errata-${safeName}.json`)
    } else {
      const json = serializeBundle(selectedFragments, mediaById, storyName, bundleConfigs)
      const safeName = (storyName ?? 'export').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40)
      downloadExportFile(json, `errata-${safeName}-${selectedFragments.length}.fragment-pack.json`)
    }
  }, [selectedFragments, mediaById, storyName, bundleConfigs])

  const handleCopyClipboard = useCallback(async () => {
    if (selectedFragments.length === 0) return

    let json: string
    if (selectedFragments.length === 1 && !bundleConfigs) {
      json = serializeFragment(selectedFragments[0], mediaById)
    } else {
      json = serializeBundle(selectedFragments, mediaById, storyName, bundleConfigs)
    }

    await navigator.clipboard.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [selectedFragments, mediaById, storyName, bundleConfigs])

  const allSelected = allExportable.length > 0 && allExportable.every((f) => selected.has(f.id))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <Package className="size-4 text-muted-foreground" />
          <h2 className="font-display text-lg">Export Fragments</h2>
          {selected.size > 0 && (
            <Badge variant="secondary" className="text-[0.625rem] h-4 tabular-nums">
              {selected.size} selected
            </Badge>
          )}
        </div>
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* Select actions */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border/30">
        <button
          onClick={allSelected ? deselectAll : selectAll}
          className="text-[0.6875rem] text-muted-foreground hover:text-foreground transition-colors"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        <span className="text-[0.625rem] text-muted-foreground">
          {allExportable.length} fragments available
        </span>
      </div>

      {/* Fragment groups */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-4 space-y-6">
          {Object.entries(grouped).map(([type, fragments]) => {
            const config = TYPE_CONFIG[type]
            if (!config) return null
            const Icon = config.icon
            const groupAllSelected = fragments.every((f) => selected.has(f.id))
            const groupSomeSelected = fragments.some((f) => selected.has(f.id))

            return (
              <div key={type}>
                {/* Group header */}
                <div
                  onClick={() => toggleGroup(type)}
                  className="flex items-center gap-2 mb-2.5 w-full group cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(type) } }}
                >
                  <Checkbox
                    checked={groupAllSelected ? true : groupSomeSelected ? 'indeterminate' : false}
                    className="size-3.5"
                    tabIndex={-1}
                  />
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
                    {config.label}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground ml-auto">
                    {fragments.filter((f) => selected.has(f.id)).length}/{fragments.length}
                  </span>
                </div>

                {/* Fragment items */}
                <div className="space-y-0.5 ml-1">
                  {fragments.map((fragment) => {
                    const isSelected = selected.has(fragment.id)
                    const visual = resolveFragmentVisual(fragment, mediaById)

                    return (
                      <div
                        key={fragment.id}
                        onClick={() => toggleFragment(fragment.id)}
                        className={`flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-left transition-colors duration-100 cursor-pointer ${
                          isSelected
                            ? 'bg-primary/5 border border-primary/15'
                            : 'hover:bg-accent/50 border border-transparent'
                        }`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFragment(fragment.id) } }}
                      >
                        <Checkbox
                          checked={isSelected}
                          className="size-3.5 shrink-0"
                          tabIndex={-1}
                        />

                        {/* Avatar */}
                        {(() => {
                          if (visual.imageUrl) {
                            return (
                              <div className="size-7 shrink-0 rounded overflow-hidden border border-border/40 bg-muted">
                                <img src={visual.imageUrl} alt="" className="size-full object-cover" />
                              </div>
                            )
                          }
                          const bubbleSet = generateBubbles(fragment.id, fragment.type)
                          return (
                            <div className="size-7 shrink-0 rounded overflow-hidden">
                              <svg viewBox="0 0 36 36" className="size-full" aria-hidden>
                                <rect width="36" height="36" fill={bubbleSet.bg} />
                                {bubbleSet.bubbles.map((b, i) => (
                                  <BubbleSvgShape key={`${b.cx}-${b.cy}`} b={b} i={i} />
                                ))}
                              </svg>
                            </div>
                          )
                        })()}

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate leading-tight">{fragment.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[0.625rem] font-mono text-muted-foreground">{fragment.id}</span>
                            {fragment.sticky && (
                              <Badge variant="secondary" className="text-[0.5625rem] h-3.5 px-1">pinned</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {allExportable.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground italic">No fragments to export</p>
              <p className="text-xs text-muted-foreground mt-1">Create some characters, guidelines, or knowledge first</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Context config toggle */}
      <div className="px-6 py-3 border-t border-border/30">
        <div
          onClick={() => setIncludeConfigs((v) => !v)}
          className="flex items-center gap-2.5 cursor-pointer group"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIncludeConfigs((v) => !v) } }}
        >
          <Checkbox checked={includeConfigs} className="size-3.5" tabIndex={-1} />
          <Settings2 className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
            Include context configuration
          </span>
        </div>
        {includeConfigs && configSummary && (
          <p className="text-[0.625rem] text-muted-foreground mt-1.5 ml-6">
            {[
              configSummary.hasBlockConfig && `${configSummary.customBlockCount} custom block${configSummary.customBlockCount !== 1 ? 's' : ''}, ${configSummary.overrideCount} override${configSummary.overrideCount !== 1 ? 's' : ''}`,
              configSummary.agentCount > 0 && `${configSummary.agentCount} agent config${configSummary.agentCount !== 1 ? 's' : ''}`,
            ].filter(Boolean).join(', ')}
          </p>
        )}
        {includeConfigs && !configSummary && exportedConfigs && (
          <p className="text-[0.625rem] text-muted-foreground mt-1.5 ml-6 italic">
            No custom configuration to export
          </p>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 px-6 py-4 border-t border-border/50">
        <Button
          size="sm"
          className="gap-1.5"
          disabled={selected.size === 0}
          onClick={handleDownload}
        >
          <Download className="size-3.5" />
          Download .json
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={selected.size === 0}
          onClick={handleCopyClipboard}
        >
          {copied ? <Check className="size-3.5 text-primary" /> : <Clipboard className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
