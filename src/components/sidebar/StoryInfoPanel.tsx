import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Pencil, Download, Package, Wand2, FileText, ImagePlus, X, ChevronDown, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { UsageSnapshot, UsageEntry, SourceUsage } from '@/lib/api/token-usage'

interface StoryInfoPanelProps {
  storyId: string
  story: StoryMeta
  onLaunchWizard?: () => void
  onExport?: () => void
  onDownloadStory?: () => void
  onExportProse?: () => void
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

export function StoryInfoPanel({ storyId, story, onLaunchWizard, onExport, onDownloadStory, onExportProse }: StoryInfoPanelProps) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(story.name)
  const [description, setDescription] = useState(story.description)
  const [summary, setSummary] = useState(story.summary ?? '')
  const [coverImage, setCoverImage] = useState<string | null>(story.coverImage ?? null)
  const coverInputRef = useRef<HTMLInputElement>(null)

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

  const tokenUsageQuery = useQuery({
    queryKey: ['token-usage', storyId],
    queryFn: () => api.tokenUsage.get(storyId),
    refetchInterval: 10_000,
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
    mutationFn: (data: { name: string; description: string; summary?: string; coverImage?: string | null }) =>
      api.stories.update(storyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
      queryClient.invalidateQueries({ queryKey: ['stories'] })
      setEditing(false)
    },
  })

  const handleSave = () => {
    updateMutation.mutate({ name: name.trim(), description: description.trim(), summary: summary.trim(), coverImage })
  }

  const handleCancel = () => {
    setName(story.name)
    setDescription(story.description)
    setSummary(story.summary ?? '')
    setCoverImage(story.coverImage ?? null)
    setEditing(false)
  }

  const handleCoverFileSelect = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => setCoverImage(reader.result as string)
    reader.readAsDataURL(file)
  }, [])

  // --- Edit mode ---
  if (editing) {
    return (
      <div className="p-4 space-y-3" data-component-id="story-info-edit">
        {/* Cover Image */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">Cover Image</label>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleCoverFileSelect(file)
              e.target.value = ''
            }}
          />
          {coverImage ? (
            <div className="relative group/cover rounded-lg overflow-hidden" style={{ aspectRatio: '3/4', maxWidth: 160 }}>
              <img src={coverImage} alt="Cover" className="w-full h-full object-cover" />
              <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/cover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="size-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                  title="Change cover"
                >
                  <ImagePlus className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setCoverImage(null)}
                  className="size-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                  title="Remove cover"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-dashed border-border/60 hover:border-border transition-colors px-3 py-2.5 w-full text-left"
            >
              <ImagePlus className="size-4 text-muted-foreground/50 shrink-0" />
              <span className="text-xs text-muted-foreground">Add cover image</span>
            </button>
          )}
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent" data-component-id="story-info-name" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">Description</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[80px] resize-none text-sm bg-transparent"
            data-component-id="story-info-description"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">Summary</label>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="min-h-[120px] resize-none text-sm bg-transparent"
            placeholder="Story summary..."
            data-component-id="story-info-summary"
          />
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={updateMutation.isPending} data-component-id="story-info-save">
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCancel} data-component-id="story-info-cancel">
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  // --- Display mode ---
  return (
    <div className="flex flex-col" data-component-id="story-info-root">
      {/* Cover image */}
      {story.coverImage && (
        <div className="relative">
          <img
            src={story.coverImage}
            alt=""
            className="w-full object-cover"
            style={{ aspectRatio: '3/2', maxHeight: 200 }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
        </div>
      )}

      {/* Title block */}
      <div className="px-5 pt-5 pb-4">
        <h2 className="text-xl font-display leading-tight tracking-tight">{story.name}</h2>
        {story.description ? (
          <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">{story.description}</p>
        ) : (
          <p className="text-[13px] text-muted-foreground mt-1.5 italic">No description</p>
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

        {/* Token usage */}
        {tokenUsageQuery.data && (tokenUsageQuery.data.session.total.calls > 0 || tokenUsageQuery.data.project.total.calls > 0) && (
          <TokenUsageSection session={tokenUsageQuery.data.session} project={tokenUsageQuery.data.project} />
        )}
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
          <label className="text-[9px] text-muted-foreground uppercase tracking-[0.15em]">Created</label>
          <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{formatDate(story.createdAt)}</p>
        </div>
        <div className="text-right">
          <label className="text-[9px] text-muted-foreground uppercase tracking-[0.15em]">Updated</label>
          <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{timeAgo(story.updatedAt)}</p>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 border-t border-border/40" />

      {/* Actions */}
      <div className="px-5 py-4 grid grid-cols-2 gap-1.5">
        <ActionTile
          icon={Pencil}
          label="Edit"
          description="Name, description & summary"
          onClick={() => setEditing(true)}
          dataComponentId="story-info-edit-action"
        />
        <ActionTile
          icon={Package}
          label="Export"
          description="Fragments as JSON"
          onClick={() => onExport?.()}
          dataComponentId="story-info-export"
        />
        <ActionTile
          icon={Download}
          label="Download"
          description="Full story as one file"
          onClick={() => onDownloadStory?.()}
          dataComponentId="story-info-download"
        />
        <ActionTile
          icon={FileText}
          label="Prose"
          description="Story text as .txt"
          onClick={() => onExportProse?.()}
          dataComponentId="story-info-prose"
        />
        {onLaunchWizard && (
          <ActionTile
            icon={Wand2}
            label="Wizard"
            description="Guided story setup"
            onClick={onLaunchWizard}
            dataComponentId="story-info-wizard"
          />
        )}
      </div>
    </div>
  )
}

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center py-2 rounded-md bg-accent/30">
      <p className="text-lg font-display leading-none tracking-tight text-foreground/85">{value}</p>
      <p className="text-[9px] text-muted-foreground uppercase tracking-[0.12em] mt-1">{label}</p>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[12px] font-mono text-foreground/60">{value}</span>
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  )
}

function ActionTile({ icon: Icon, label, description, onClick, dataComponentId }: { icon: LucideIcon; label: string; description: string; onClick: () => void; dataComponentId?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-2.5 rounded-md border border-border/40 px-3 py-2.5 text-left transition-colors hover:bg-accent/40 hover:border-border/60"
      data-component-id={dataComponentId}
    >
      <Icon className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <p className="text-[12px] font-medium leading-none text-foreground/80">{label}</p>
        <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{description}</p>
      </div>
    </button>
  )
}

const SOURCE_LABELS: Record<string, string> = {
  'generation.writer': 'Writer',
  'generation.prewriter': 'Prewriter',
  'librarian.analyze': 'Librarian',
  'librarian.summary-compaction': 'Summary compaction',
  'librarian.chat': 'Librarian chat',
  'librarian.refine': 'Librarian refine',
  'librarian.prose-transform': 'Prose transform',
  'librarian.optimize-character': 'Character optimizer',
  'directions.suggest': 'Directions',
  'character-chat.chat': 'Character chat',
}

function formatSourceName(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

function shortModelName(modelId: string): string {
  // Show just the model name portion after the last slash or colon
  const parts = modelId.split(/[/:@]/)
  return parts[parts.length - 1] || modelId
}

function UsageRow({ label, entry, indent }: { label: string; entry: UsageEntry; indent?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between ${indent ? 'pl-3' : ''}`}>
      <span className={`text-[10px] text-muted-foreground ${indent ? '' : 'uppercase tracking-wider'} truncate mr-2`}>{label}</span>
      <span className="text-[11px] font-mono text-foreground/60 whitespace-nowrap shrink-0">
        {formatNumber(entry.inputTokens)} in &middot; {formatNumber(entry.outputTokens)} out
      </span>
    </div>
  )
}

function UsageBreakdown({ label, snapshot }: { label: string; snapshot: UsageSnapshot }) {
  const [expanded, setExpanded] = useState(false)
  if (snapshot.total.calls === 0) return null

  const sources = Object.entries(snapshot.sources)
    .sort((a, b) => (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens))
  const models = Object.entries(snapshot.byModel)
    .sort((a, b) => (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens))

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 w-full group"
      >
        {expanded
          ? <ChevronDown className="size-3 text-muted-foreground/50" />
          : <ChevronRight className="size-3 text-muted-foreground/50" />
        }
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="text-[11px] font-mono text-foreground/60 ml-auto whitespace-nowrap">
          {formatNumber(snapshot.total.inputTokens)} in &middot; {formatNumber(snapshot.total.outputTokens)} out
        </span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 ml-1">
          {sources.length > 0 && (
            <>
              <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mt-1.5 mb-0.5">By agent</div>
              {sources.map(([source, entry]) => (
                <div key={source}>
                  <UsageRow label={formatSourceName(source)} entry={entry} indent />
                  {Object.keys(entry.byModel).length > 1 && Object.entries(entry.byModel)
                    .sort((a, b) => (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens))
                    .map(([model, mEntry]) => (
                      <div key={model} className="pl-6 flex items-baseline justify-between opacity-60">
                        <span className="text-[9px] text-muted-foreground truncate mr-2">{shortModelName(model)}</span>
                        <span className="text-[10px] font-mono text-foreground/50 whitespace-nowrap shrink-0">
                          {formatNumber(mEntry.inputTokens)} in &middot; {formatNumber(mEntry.outputTokens)} out
                        </span>
                      </div>
                    ))
                  }
                </div>
              ))}
            </>
          )}
          {models.length > 1 && (
            <>
              <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mt-1.5 mb-0.5">By model</div>
              {models.map(([model, entry]) => (
                <UsageRow key={model} label={shortModelName(model)} entry={entry} indent />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TokenUsageSection({ session, project }: { session: UsageSnapshot; project: UsageSnapshot }) {
  return (
    <div className="mt-3 pt-3 border-t border-border/30">
      <label className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium">Token Usage</label>
      <div className="mt-1.5 space-y-1">
        <UsageBreakdown label="Session" snapshot={session} />
        <UsageBreakdown label="Project" snapshot={project} />
      </div>
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
    const maxH = window.innerHeight * 0.2
    setOverflows(el.scrollHeight > maxH)
  }, [summary])

  if (!summary) {
    return (
      <div className="px-5 py-4">
        <label className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium">Summary</label>
        <p className="text-[13px] text-muted-foreground mt-1.5 italic">No summary yet</p>
      </div>
    )
  }

  return (
    <div className="px-5 py-4">
      <label className="text-[9px] text-muted-foreground uppercase tracking-[0.15em] font-medium">Summary</label>
      <div className="relative">
        <div
          ref={contentRef}
          className="overflow-hidden transition-[max-height] duration-300 ease-out"
          style={{ maxHeight: expanded ? 'none' : '20vh' }}
        >
          <p className="text-[13px] leading-relaxed mt-1.5 text-foreground/80 font-prose whitespace-pre-wrap">{summary}</p>
        </div>
        {overflows && !expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        )}
        {overflows && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-muted-foreground hover:text-muted-foreground mt-1 transition-colors"
            data-component-id="story-info-summary-toggle"
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>
    </div>
  )
}
