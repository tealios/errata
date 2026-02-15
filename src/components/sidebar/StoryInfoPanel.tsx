import { useState, useRef, useMemo, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Pencil, Download, Package, Wand2 } from 'lucide-react'

interface StoryInfoPanelProps {
  storyId: string
  story: StoryMeta
  onLaunchWizard?: () => void
  onExport?: () => void
  onDownloadStory?: () => void
}

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

export function StoryInfoPanel({ storyId, story, onLaunchWizard, onExport, onDownloadStory }: StoryInfoPanelProps) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(story.name)
  const [description, setDescription] = useState(story.description)
  const [summary, setSummary] = useState(story.summary ?? '')

  // Data queries for stats
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
          onClick={() => onExport?.()}
        >
          <Package className="size-3" />
          Export
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={() => onDownloadStory?.()}
        >
          <Download className="size-3" />
          Download
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
