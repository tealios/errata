import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Pencil, Download, Upload, Wand2 } from 'lucide-react'

interface StoryInfoPanelProps {
  storyId: string
  story: StoryMeta
  onLaunchWizard?: () => void
}

interface ExportData {
  exportedAt: string
  storyName: string
  fragments: Array<{
    type: string
    name: string
    description: string
    content: string
    tags: string[]
    sticky: boolean
    meta: Record<string, unknown>
  }>
}

const EXPORT_TYPES = [
  { type: 'character', label: 'Characters', defaultChecked: true },
  { type: 'guideline', label: 'Guidelines', defaultChecked: true },
  { type: 'knowledge', label: 'Knowledge', defaultChecked: true },
  { type: 'prose', label: 'Prose', defaultChecked: false },
] as const

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function formatNumber(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export function StoryInfoPanel({ storyId, story, onLaunchWizard }: StoryInfoPanelProps) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(story.name)
  const [description, setDescription] = useState(story.description)
  const [summary, setSummary] = useState(story.summary ?? '')

  // Export state
  const [exportOpen, setExportOpen] = useState(false)
  const [exportTypes, setExportTypes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(EXPORT_TYPES.map(t => [t.type, t.defaultChecked]))
  )
  const [exporting, setExporting] = useState(false)

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importData, setImportData] = useState<ExportData | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // Data queries for stats
  const typesQuery = useQuery({
    queryKey: ['fragment-types', storyId],
    queryFn: () => api.fragments.types(storyId),
  })

  const allFragmentsQuery = useQuery({
    queryKey: ['fragments', storyId],
    queryFn: () => api.fragments.list(storyId),
  })

  const proseChainQuery = useQuery({
    queryKey: ['proseChain', storyId],
    queryFn: () => api.proseChain.get(storyId),
  })

  const genLogsQuery = useQuery({
    queryKey: ['generation-logs', storyId],
    queryFn: () => api.generation.listLogs(storyId),
  })

  // Compute stats
  const stats = useMemo(() => {
    const fragments = allFragmentsQuery.data ?? []
    const active = fragments.filter(f => !f.archived)

    const byType: Record<string, number> = {}
    for (const f of active) {
      byType[f.type] = (byType[f.type] || 0) + 1
    }

    const proseFragments = active.filter(f => f.type === 'prose')
    const wordCount = proseFragments.reduce((sum, f) => sum + countWords(f.content), 0)
    const charCount = proseFragments.reduce((sum, f) => sum + f.content.length, 0)

    const passages = proseChainQuery.data?.entries.length ?? 0
    const totalVariations = proseChainQuery.data?.entries.reduce(
      (sum, e) => sum + e.proseFragments.length, 0
    ) ?? 0

    const pinned = active.filter(f => f.sticky).length
    const archived = fragments.filter(f => f.archived).length
    const generations = genLogsQuery.data?.length ?? 0

    return {
      byType,
      totalFragments: active.length,
      wordCount,
      charCount,
      passages,
      totalVariations,
      pinned,
      archived,
      generations,
      characters: byType['character'] ?? 0,
      guidelines: byType['guideline'] ?? 0,
      knowledge: byType['knowledge'] ?? 0,
    }
  }, [allFragmentsQuery.data, proseChainQuery.data, genLogsQuery.data])

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      api.stories.update(storyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
      setEditing(false)
    },
  })

  const handleSave = () => {
    updateMutation.mutate({ name: name.trim(), description: description.trim(), summary: summary.trim() })
  }

  const handleCancel = () => {
    setName(story.name)
    setDescription(story.description)
    setSummary(story.summary ?? '')
    setEditing(false)
  }

  // --- Export ---

  const handleExport = async () => {
    setExporting(true)
    try {
      const selectedTypes = Object.entries(exportTypes)
        .filter(([, checked]) => checked)
        .map(([type]) => type)

      const allFragments: Fragment[] = []
      for (const type of selectedTypes) {
        const fragments = await api.fragments.list(storyId, type)
        allFragments.push(...fragments)
      }

      const exportData: ExportData = {
        exportedAt: new Date().toISOString(),
        storyName: story.name,
        fragments: allFragments.map(f => ({
          type: f.type,
          name: f.name,
          description: f.description,
          content: f.content,
          tags: f.tags,
          sticky: f.sticky,
          meta: f.meta,
        })),
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${story.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-fragments.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setExportOpen(false)
    } finally {
      setExporting(false)
    }
  }

  const handleExportToggle = (type: string, checked: boolean) => {
    setExportTypes(prev => ({ ...prev, [type]: checked }))
  }

  const selectedExportCount = Object.values(exportTypes).filter(Boolean).length

  // --- Import ---

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset for next pick
    e.target.value = ''

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as ExportData
        if (!data.fragments || !Array.isArray(data.fragments)) {
          setImportError('Invalid export file: missing fragments array')
          return
        }
        for (const f of data.fragments) {
          if (!f.type || !f.name || typeof f.content !== 'string') {
            setImportError('Invalid export file: fragments must have type, name, and content')
            return
          }
        }
        setImportError(null)
        setImportData(data)
        setImportOpen(true)
      } catch {
        setImportError('Failed to parse JSON file')
      }
    }
    reader.readAsText(file)
  }, [])

  const handleImportConfirm = async () => {
    if (!importData) return
    setImporting(true)
    try {
      for (const f of importData.fragments) {
        await api.fragments.create(storyId, {
          type: f.type,
          name: f.name,
          description: f.description || '',
          content: f.content,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      setImportOpen(false)
      setImportData(null)
    } finally {
      setImporting(false)
    }
  }

  const importCounts = importData
    ? importData.fragments.reduce<Record<string, number>>((acc, f) => {
        acc[f.type] = (acc[f.type] || 0) + 1
        return acc
      }, {})
    : {}

  // Build export type list
  const exportTypeList = typesQuery.data
    ? typesQuery.data.map(t => ({
        type: t.type,
        label: t.type.charAt(0).toUpperCase() + t.type.slice(1) + 's',
        defaultChecked: t.type !== 'prose',
      }))
    : [...EXPORT_TYPES]

  // --- Edit mode ---
  if (editing) {
    return (
      <div className="p-4 space-y-3">
        <div>
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1.5 block">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1.5 block">Description</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[80px] resize-none text-sm bg-transparent"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1.5 block">Summary</label>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="min-h-[120px] resize-none text-sm bg-transparent"
            placeholder="Story summary..."
          />
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  // --- Display mode ---
  return (
    <div className="flex flex-col">
      {/* Title block */}
      <div className="px-5 pt-5 pb-4">
        <h2 className="text-xl font-display leading-tight tracking-tight">{story.name}</h2>
        {story.description ? (
          <p className="text-[13px] text-muted-foreground/60 mt-1.5 leading-relaxed">{story.description}</p>
        ) : (
          <p className="text-[13px] text-muted-foreground/25 mt-1.5 italic">No description</p>
        )}
      </div>

      {/* Divider */}
      <div className="mx-5 border-t border-border/40" />

      {/* Stats grid */}
      <div className="px-5 py-4">
        <div className="grid grid-cols-3 gap-x-3 gap-y-3">
          <StatCell value={formatNumber(stats.wordCount)} label="words" />
          <StatCell value={String(stats.passages)} label="passages" />
          <StatCell value={String(stats.generations)} label="generations" />
          <StatCell value={String(stats.characters)} label="characters" />
          <StatCell value={String(stats.guidelines)} label="guidelines" />
          <StatCell value={String(stats.knowledge)} label="knowledge" />
        </div>

        {/* Secondary stats row */}
        <div className="flex gap-4 mt-3 pt-3 border-t border-border/30">
          <MiniStat label="pinned" value={stats.pinned} />
          <MiniStat label="archived" value={stats.archived} />
          <MiniStat label="variations" value={stats.totalVariations} />
          <MiniStat label="total" value={stats.totalFragments} />
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 border-t border-border/40" />

      {/* Summary */}
      <SummarySection summary={story.summary} />

      {/* Divider */}
      <div className="mx-5 border-t border-border/40" />

      {/* Dates */}
      <div className="px-5 py-4 flex justify-between">
        <div>
          <label className="text-[9px] text-muted-foreground/30 uppercase tracking-[0.15em]">Created</label>
          <p className="text-[11px] text-muted-foreground/50 mt-0.5 font-mono">{formatDate(story.createdAt)}</p>
        </div>
        <div className="text-right">
          <label className="text-[9px] text-muted-foreground/30 uppercase tracking-[0.15em]">Updated</label>
          <p className="text-[11px] text-muted-foreground/50 mt-0.5 font-mono">{timeAgo(story.updatedAt)}</p>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 border-t border-border/40" />

      {/* Actions */}
      <div className="px-5 py-4 flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={() => {
            setExportTypes(Object.fromEntries(exportTypeList.map(t => [t.type, t.defaultChecked])))
            setExportOpen(true)
          }}
        >
          <Download className="size-3" />
          Export
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3" />
          Import
        </Button>
        {onLaunchWizard && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={onLaunchWizard}
          >
            <Wand2 className="size-3" />
            Wizard
          </Button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileSelect}
      />

      {importError && (
        <p className="text-xs text-destructive px-5 pb-3">{importError}</p>
      )}

      {/* Export Dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Fragments</DialogTitle>
            <DialogDescription>
              Select which fragment types to include in the export.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {exportTypeList.map(t => (
              <label key={t.type} className="flex items-center gap-2.5 cursor-pointer">
                <Checkbox
                  checked={exportTypes[t.type] ?? t.defaultChecked}
                  onCheckedChange={(checked) => handleExportToggle(t.type, checked === true)}
                />
                <span className="text-sm">{t.label}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleExport}
              disabled={exporting || selectedExportCount === 0}
            >
              {exporting ? 'Exporting...' : 'Export'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Confirmation Dialog */}
      <Dialog open={importOpen} onOpenChange={(open) => {
        if (!open) {
          setImportOpen(false)
          setImportData(null)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Fragments</DialogTitle>
            <DialogDescription>
              {importData?.storyName && (
                <>Exported from "{importData.storyName}". </>
              )}
              The following fragments will be created:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            {Object.entries(importCounts).map(([type, count]) => (
              <div key={type} className="flex justify-between text-sm">
                <span className="capitalize">{type}s</span>
                <span className="text-muted-foreground">{count}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-medium pt-1.5 border-t">
              <span>Total</span>
              <span>{importData?.fragments.length ?? 0}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => {
              setImportOpen(false)
              setImportData(null)
            }}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleImportConfirm}
              disabled={importing}
            >
              {importing ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center py-2 rounded-md bg-accent/30">
      <p className="text-lg font-display leading-none tracking-tight text-foreground/85">{value}</p>
      <p className="text-[9px] text-muted-foreground/40 uppercase tracking-[0.12em] mt-1">{label}</p>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[12px] font-mono text-foreground/60">{value}</span>
      <span className="text-[9px] text-muted-foreground/35 uppercase tracking-wider">{label}</span>
    </div>
  )
}

function SummarySection({ summary }: { summary: string | undefined }) {
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const maxH = window.innerHeight * 0.5
    setOverflows(el.scrollHeight > maxH)
  }, [summary])

  if (!summary) {
    return (
      <div className="px-5 py-4">
        <label className="text-[9px] text-muted-foreground/35 uppercase tracking-[0.15em] font-medium">Summary</label>
        <p className="text-[13px] text-muted-foreground/25 mt-1.5 italic">No summary yet</p>
      </div>
    )
  }

  return (
    <div className="px-5 py-4">
      <label className="text-[9px] text-muted-foreground/35 uppercase tracking-[0.15em] font-medium">Summary</label>
      <div className="relative">
        <div
          ref={contentRef}
          className="overflow-hidden transition-[max-height] duration-300 ease-out"
          style={{ maxHeight: expanded ? 'none' : '50vh' }}
        >
          <p className="text-[13px] leading-relaxed mt-1.5 text-foreground/80 font-prose whitespace-pre-wrap">{summary}</p>
        </div>
        {overflows && !expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        )}
        {overflows && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground mt-1 transition-colors"
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>
    </div>
  )
}
