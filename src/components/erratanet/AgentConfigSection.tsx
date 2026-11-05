import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { AgentPresetListResponse, AgentPresetSummary } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Share2, Loader2, Code2, Trash2, Check, Plus, Bookmark, ArrowUpFromLine } from 'lucide-react'
import { ShareAgentConfigDialog } from './ShareAgentConfigDialog'
import { PackLink } from './PackLink'

/** A config shared from this story, as stamped on the story's erratanet settings. */
interface SharedConfig {
  pack: string
  version: string
  includes: string[]
}

/** Short, human label for each bundled surface (parallels "N fragments"). */
const INCLUDE_SHORT: Record<string, string> = {
  'agent-blocks': 'blocks',
  'provider-shape': 'providers',
  'model-roles': 'models',
}

function includesLabel(includes: string[]): string {
  const parts = includes.map((i) => INCLUDE_SHORT[i] ?? i)
  return parts.length > 0 ? parts.join(', ') : 'nothing'
}

/** Small uppercase block label, matching the panel's other sections. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[0.625rem] font-medium uppercase tracking-[0.13em] text-muted-foreground">
      {children}
    </p>
  )
}

/**
 * The agent-configuration block of the ErrataNet panel. Shares this story's setup
 * as a config pack and lists already-shared configs with a re-sync, mirroring how
 * fragment packs are published and synced. Also manages story-independent presets.
 */
export function AgentConfigSection({
  storyId,
  storyName,
  sharedConfigs = [],
  hubUrl,
}: {
  storyId: string
  storyName?: string
  sharedConfigs?: SharedConfig[]
  hubUrl?: string
}) {
  const qc = useQueryClient()
  // null = closed. {} = share a new config. {slug, includes} = sync an existing one.
  const [share, setShare] = useState<{ slug?: string; includes?: string[] } | null>(null)
  const [savingName, setSavingName] = useState<string | null>(null)

  const { data, isLoading } = useQuery<AgentPresetListResponse>({
    queryKey: ['agent-presets'],
    queryFn: () => api.erratanet.presets.list(),
  })
  const presets = data?.presets ?? []

  const saveMut = useMutation({
    mutationFn: (name: string) => api.erratanet.presets.save({ name, fromStoryId: storyId }),
    onSuccess: () => {
      setSavingName(null)
      qc.invalidateQueries({ queryKey: ['agent-presets'] })
    },
  })

  return (
    <section>
      <Label>Agent configuration</Label>
      <p className="mb-3 text-[0.75rem] leading-snug text-muted-foreground">
        Share how you&apos;ve tuned this story&apos;s agents, or apply a saved preset to it.
      </p>

      {/* Configs already shared from this story — re-syncable, like fragment packs. */}
      {sharedConfigs.length > 0 && (
        <div className="mb-3 space-y-2">
          <p className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">Shared configs</p>
          {sharedConfigs.map((sc) => (
            <div
              key={sc.pack}
              className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <PackLink pack={sc.pack} hubUrl={hubUrl} className="text-[0.75rem]" />
                <p className="font-mono text-[0.625rem] text-muted-foreground">
                  v{sc.version} · {includesLabel(sc.includes)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1.5 px-2.5 text-[0.6875rem]"
                onClick={() => setShare({ slug: sc.pack.split('/')[1], includes: sc.includes })}
              >
                <ArrowUpFromLine className="size-3" />
                Sync
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Button variant="outline" className="w-full gap-2" onClick={() => setShare({})}>
          <Share2 className="size-4" />
          {sharedConfigs.length > 0 ? 'Share a new config' : 'Share this config'}
        </Button>

        {savingName === null ? (
          <Button
            variant="ghost"
            className="h-8 w-full justify-start gap-2 px-2 text-[0.75rem] text-muted-foreground hover:text-foreground"
            onClick={() => setSavingName(storyName ? `${storyName} setup` : '')}
          >
            <Plus className="size-3.5" />
            Save current config as a preset
          </Button>
        ) : (
          <div className="flex gap-2">
            <Input
              autoFocus
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && savingName.trim()) saveMut.mutate(savingName.trim())
                if (e.key === 'Escape') setSavingName(null)
              }}
              placeholder="Preset name"
              className="h-8"
            />
            <Button
              size="sm"
              className="h-8 shrink-0 gap-1"
              disabled={!savingName.trim() || saveMut.isPending}
              onClick={() => saveMut.mutate(savingName.trim())}
            >
              {saveMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Save
            </Button>
          </div>
        )}
        {saveMut.error && (
          <p className="text-[0.6875rem] text-destructive">
            {saveMut.error instanceof Error ? saveMut.error.message : 'Could not save preset.'}
          </p>
        )}
      </div>

      {/* Presets */}
      <div className="mt-4">
        <p className="mb-2 text-[0.625rem] uppercase tracking-wider text-muted-foreground">Presets</p>
        {isLoading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </p>
        ) : presets.length === 0 ? (
          <p className="text-[0.6875rem] leading-snug text-muted-foreground">
            No presets yet. Save one above, or import a config from the hub.
          </p>
        ) : (
          <div className="space-y-2">
            {presets.map((preset) => (
              <PresetRow key={preset.id} preset={preset} storyId={storyId} />
            ))}
          </div>
        )}
      </div>

      <ShareAgentConfigDialog
        open={share !== null}
        onOpenChange={(o) => setShare(o ? (share ?? {}) : null)}
        storyId={storyId}
        storyName={storyName}
        defaultSlug={share?.slug}
        defaultIncludes={share?.includes}
      />
    </section>
  )
}

function PresetRow({ preset, storyId }: { preset: AgentPresetSummary; storyId: string }) {
  const qc = useQueryClient()
  const [confirmingScripts, setConfirmingScripts] = useState(false)
  const [applied, setApplied] = useState(false)

  const applyMut = useMutation({
    mutationFn: (consentToScripts: boolean) =>
      api.erratanet.presets.apply(preset.id, {
        storyId,
        ...(consentToScripts ? { consentToScripts: true } : {}),
      }),
    onSuccess: () => {
      setApplied(true)
      setConfirmingScripts(false)
      qc.invalidateQueries({ queryKey: ['agent-blocks'] })
      qc.invalidateQueries({ queryKey: ['story', storyId] })
      qc.invalidateQueries({ queryKey: ['global-config'] })
    },
    onError: (err) => {
      // The stored summary can be stale about scripts; when the server says
      // consent is required, fall into the same confirm flow instead of a
      // dead-end error message.
      if (err instanceof ApiError && err.data.requiresConsent === true) {
        setConfirmingScripts(true)
      }
    },
  })

  const runsCode = preset.summary.hasScripts

  const delMut = useMutation({
    mutationFn: () => api.erratanet.presets.remove(preset.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-presets'] }),
  })

  const onApply = () => {
    if (runsCode && !confirmingScripts) {
      setConfirmingScripts(true)
      return
    }
    applyMut.mutate(runsCode)
  }

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] text-foreground">{preset.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.625rem] text-muted-foreground">
            <span className="tabular-nums">
              {preset.summary.agents.length} {preset.summary.agents.length === 1 ? 'agent' : 'agents'} · {preset.summary.blockCount} {preset.summary.blockCount === 1 ? 'block' : 'blocks'}
            </span>
            {preset.summary.hasScripts && (
              <span className="inline-flex items-center gap-0.5 font-mono lowercase text-amber-600 dark:text-amber-400">
                <Code2 className="size-2.5" /> runs code
              </span>
            )}
            {preset.source && <span className="font-mono">from {preset.source.pack}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[0.6875rem]"
            disabled={applyMut.isPending || applied}
            onClick={onApply}
          >
            {applyMut.isPending ? <Loader2 className="size-3 animate-spin" /> : applied ? <Check className="size-3" /> : <Bookmark className="size-3" />}
            {applied ? 'Applied' : 'Apply'}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-destructive"
            disabled={delMut.isPending}
            onClick={() => delMut.mutate()}
            aria-label={`Delete ${preset.name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {confirmingScripts && !applied && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
          <p className="text-[0.6875rem] leading-snug text-muted-foreground">
            This preset runs code. Apply it to this story?
          </p>
          <div className="mt-1.5 flex gap-2">
            <Button size="sm" className={cn('h-7 gap-1 px-2.5 text-[0.6875rem]')} onClick={() => applyMut.mutate(true)} disabled={applyMut.isPending}>
              {applyMut.isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              Apply anyway
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2.5 text-[0.6875rem]" onClick={() => setConfirmingScripts(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {applyMut.error && !confirmingScripts && (
        <p className="mt-1.5 text-[0.6875rem] text-destructive">
          {applyMut.error instanceof Error ? applyMut.error.message : 'Apply failed.'}
        </p>
      )}
    </div>
  )
}
