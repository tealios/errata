import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ErratanetPackDetail, ErratanetPackSummary } from '@/lib/api/types'
import { parseGlobalPackId } from '@/lib/erratanet/pack-schema'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyHint } from '@/components/ui/prose-text'
import { cn } from '@/lib/utils'
import { AgentConfigImportView } from './AgentConfigImportView'
import {
  X,
  ArrowLeft,
  Search,
  Loader2,
  Package,
  BookOpen,
  Download,
  ShieldAlert,
  Link2,
  SlidersHorizontal,
  Code2,
} from 'lucide-react'

interface ErratanetBrowserPanelProps {
  /** When set, loose fragment packs can be installed into this story. */
  storyId?: string
  onClose: () => void
}

type InstallTarget = 'this-story' | 'new-story'
type KindFilter = 'all' | 'story' | 'fragment-pack' | 'agent-config'

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'story', label: 'Stories' },
  { value: 'fragment-pack', label: 'Packs' },
  { value: 'agent-config', label: 'Configs' },
]

/**
 * Parse a typed reference into a global pack id + optional version.
 * Accepts `@user/pack`, `@user/pack@1.2.3`, or a full hub URL whose path ends
 * in `@user/pack` (optionally with a trailing `@version` or `?version=`).
 */
function parsePackRef(raw: string): { id: string; version?: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Full URL form: pull the @handle/slug out of the path + any version query.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const queryVersion = url.searchParams.get('version') ?? undefined
      const match = url.pathname.match(/@[a-z0-9-]+\/[a-z0-9-]+(?:@[^/]+)?/i)
      if (!match) return null
      return splitIdVersion(match[0], queryVersion)
    } catch {
      return null
    }
  }

  return splitIdVersion(trimmed)
}

function splitIdVersion(ref: string, fallbackVersion?: string): { id: string; version?: string } | null {
  // Split a trailing `@version` that follows the slug (the id's own leading @
  // is at index 0, so look for an @ after the slash).
  const slash = ref.indexOf('/')
  if (slash === -1) return null
  const atAfterSlash = ref.indexOf('@', slash)
  let id = ref
  let version = fallbackVersion
  if (atAfterSlash !== -1) {
    id = ref.slice(0, atAfterSlash)
    version = ref.slice(atAfterSlash + 1) || fallbackVersion
  }
  if (!parseGlobalPackId(id)) return null
  return { id, version }
}

export function ErratanetBrowserPanel({ storyId, onClose }: ErratanetBrowserPanelProps) {
  const queryClient = useQueryClient()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ErratanetPackSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [selected, setSelected] = useState<ErratanetPackDetail | null>(null)
  const [configRef, setConfigRef] = useState<{ id: string; version?: string } | null>(null)
  const [loadingPack, setLoadingPack] = useState(false)
  const [packError, setPackError] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')

  const [target, setTarget] = useState<InstallTarget>(storyId ? 'this-story' : 'new-story')
  const [installResult, setInstallResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [directRef, setDirectRef] = useState('')
  const [directError, setDirectError] = useState<string | null>(null)

  const runSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    try {
      const res = (await api.erratanet.search(q)) as unknown as
        | ErratanetPackSummary[]
        | { results?: ErratanetPackSummary[] }
      setResults(Array.isArray(res) ? res : res.results ?? [])
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.')
      setResults(null)
    } finally {
      setSearching(false)
    }
  }, [query])

  const openPack = useCallback(
    async (id: string, version?: string) => {
      setLoadingPack(true)
      setPackError(null)
      setInstallResult(null)
      try {
        const pack = await api.erratanet.getPack(id, version)
        // Agent-config packs route to the dedicated import flow (preview +
        // consent + apply/preset), not the fragment/story install path. A
        // version the user pinned wins over the pack detail's (latest) version.
        if (pack.contentKind === 'agent-config') {
          setConfigRef({ id: pack.id, version: version ?? pack.version })
          setSelected(null)
          return
        }
        setSelected(pack)
        // Story packs always install as a new story; loose packs default to the
        // current story when one is in scope.
        setTarget(pack.contentKind === 'story' || !storyId ? 'new-story' : 'this-story')
      } catch (err) {
        setPackError(err instanceof Error ? err.message : 'Could not load pack.')
        setSelected(null)
      } finally {
        setLoadingPack(false)
      }
    },
    [storyId],
  )

  const handleDirectInstall = useCallback(() => {
    setDirectError(null)
    const parsed = parsePackRef(directRef)
    if (!parsed) {
      setDirectError('Enter @user/pack, @user/pack@version, or a full pack URL.')
      return
    }
    openPack(parsed.id, parsed.version)
  }, [directRef, openPack])

  const installMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('No pack selected.')
      const asNewStory = selected.contentKind === 'story' || target === 'new-story'
      return api.erratanet.install({
        id: selected.id,
        version: selected.version,
        targetStoryId: asNewStory ? undefined : storyId,
        asNewStory,
      })
    },
    onSuccess: (res) => {
      // Refresh anything the install could have touched.
      queryClient.invalidateQueries({ queryKey: ['stories'] })
      if (res.createdStory && res.storyId) {
        queryClient.invalidateQueries({ queryKey: ['fragments', res.storyId] })
        queryClient.invalidateQueries({ queryKey: ['proseChain', res.storyId] })
      }
      if (storyId) {
        queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
        queryClient.invalidateQueries({ queryKey: ['fragment-count', storyId] })
        queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      }
      const where = res.createdStory ? 'a new story' : 'this story'
      setInstallResult({
        ok: true,
        message: `Installed ${res.fragmentCount} ${res.fragmentCount === 1 ? 'fragment' : 'fragments'} into ${where}.`,
      })
    },
    onError: (err) => {
      setInstallResult({ ok: false, message: err instanceof Error ? err.message : 'Install failed.' })
    },
  })

  const clearSelection = useCallback(() => {
    setSelected(null)
    setConfigRef(null)
    setPackError(null)
    setInstallResult(null)
  }, [])

  // Client-side kind filter over the mixed hub search results.
  const visibleResults = useMemo(() => {
    if (!results) return null
    if (kindFilter === 'all') return results
    return results.filter((r) => r.contentKind === kindFilter)
  }, [results, kindFilter])

  return (
    <div className="flex flex-col h-full" data-component-id="erratanet-browser-root">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          {(selected || configRef) && (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground"
              onClick={clearSelection}
              data-component-id="erratanet-browser-back"
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <h2 className="font-display text-lg">Browse and Install Packs</h2>
          <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wider">
            {configRef ? 'Import Config' : selected ? 'Pack Detail' : 'ErrataNet'}
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground"
          onClick={onClose}
          data-component-id="erratanet-browser-close"
        >
          <X className="size-4" />
        </Button>
      </div>

      {configRef ? (
        <AgentConfigImportView id={configRef.id} version={configRef.version} storyId={storyId} />
      ) : selected ? (
        <PackDetailView
          pack={selected}
          storyId={storyId}
          target={target}
          onTargetChange={setTarget}
          installResult={installResult}
          installing={installMutation.isPending}
          onInstall={() => installMutation.mutate()}
        />
      ) : (
        <ScrollArea className="flex-1" data-component-id="erratanet-browser-scroll">
          <div className="max-w-2xl mx-auto p-6 space-y-6">
            {/* Search */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Search</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
                    placeholder="Find packs, stories, and agent configs"
                    className="pl-8"
                  />
                </div>
                <Button onClick={runSearch} disabled={searching || !query.trim()} className="gap-1.5 shrink-0">
                  {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                  Search
                </Button>
              </div>
              {searchError && <p className="text-xs text-destructive mt-2">{searchError}</p>}
            </div>

            {/* Install by reference */}
            <div className="rounded-md border border-border/30 bg-accent/10 p-3">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Install by reference</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={directRef}
                    onChange={(e) => setDirectRef(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleDirectInstall() }}
                    placeholder="@user/pack@version or full URL"
                    className="pl-8 font-mono text-xs"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={handleDirectInstall}
                  disabled={loadingPack || !directRef.trim()}
                  className="gap-1.5 shrink-0"
                >
                  {loadingPack ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  Open
                </Button>
              </div>
              {directError && <p className="text-xs text-destructive mt-2">{directError}</p>}
            </div>

            {packError && <p className="text-xs text-destructive">{packError}</p>}

            {/* Kind filter (over the mixed search results) */}
            {results && results.length > 0 && (
              <div className="flex w-fit gap-[3px] rounded-lg bg-muted/25 p-[3px]">
                {KIND_FILTERS.map((k) => {
                  const count =
                    k.value === 'all' ? results.length : results.filter((r) => r.contentKind === k.value).length
                  return (
                    <button
                      key={k.value}
                      type="button"
                      onClick={() => setKindFilter(k.value)}
                      className={cn(
                        'rounded-md px-2.5 py-[5px] text-[0.6875rem] font-medium transition-all duration-150',
                        kindFilter === k.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {k.label}
                      <span className="ml-1 tabular-nums opacity-60">{count}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Results */}
            <div className="space-y-2">
              {visibleResults === null ? (
                <EmptyHint className="py-8 text-center block">
                  Search the hub to discover fragment packs, stories, and agent configs.
                </EmptyHint>
              ) : visibleResults.length === 0 ? (
                <EmptyHint className="py-8 text-center block">
                  {results && results.length > 0 ? 'Nothing of this kind in the results.' : 'No packs matched that search.'}
                </EmptyHint>
              ) : (
                visibleResults.map((r) => (
                  <ResultRow
                    key={`${r.id}@${r.version}`}
                    result={r}
                    busy={loadingPack}
                    onSelect={() => openPack(r.id, r.version)}
                  />
                ))
              )}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

function ResultRow({
  result,
  onSelect,
  busy,
}: {
  result: ErratanetPackSummary
  onSelect: () => void
  busy: boolean
}) {
  const isStory = result.contentKind === 'story'
  const isConfig = result.contentKind === 'agent-config'
  const runsCode = result.agentConfig?.hasScripts ?? result.capabilities?.includes('scripts') ?? false
  const idParts = parseGlobalPackId(result.id)
  const handleLabel = result.publisher ?? (idParts ? `@${idParts.handle}` : result.id)
  return (
    <button
      onClick={onSelect}
      disabled={busy}
      className="flex items-start gap-3 w-full text-left px-4 py-3 rounded-lg border border-border/30 hover:border-border/50 hover:bg-accent/20 transition-colors disabled:opacity-60"
    >
      <div className="size-12 shrink-0 rounded-md border border-border/30 bg-muted overflow-hidden flex items-center justify-center">
        {result.thumbnail ? (
          <img src={result.thumbnail} alt="" className="size-full object-cover" />
        ) : isConfig ? (
          <SlidersHorizontal className="size-5 text-muted-foreground" />
        ) : isStory ? (
          <BookOpen className="size-5 text-muted-foreground" />
        ) : (
          <Package className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{result.title}</span>
          <Badge variant="secondary" className="text-[0.5625rem] h-4 shrink-0">{isConfig ? 'config' : isStory ? 'story' : 'pack'}</Badge>
          {runsCode && (
            <span className="inline-flex items-center gap-0.5 rounded border border-amber-500/40 px-1 font-mono text-[0.5625rem] lowercase text-amber-600 dark:text-amber-400 shrink-0">
              <Code2 className="size-2.5" /> code
            </span>
          )}
          {result.nsfw && (
            <Badge className="text-[0.5625rem] h-4 shrink-0 bg-destructive/15 text-destructive border-transparent">nsfw</Badge>
          )}
          <span className="text-[0.625rem] font-mono text-muted-foreground ml-auto shrink-0">v{result.version}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[0.6875rem] font-mono text-muted-foreground truncate">
            {handleLabel}{idParts ? `/${idParts.slug}` : ''}
          </span>
        </div>
        {result.description && (
          <p className="text-[0.6875rem] text-muted-foreground line-clamp-2 mt-1">{result.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {isConfig ? (
            result.agentConfig ? (
              <span className="text-[0.5625rem] text-muted-foreground tabular-nums mr-0.5">
                {result.agentConfig.blockCount} {result.agentConfig.blockCount === 1 ? 'block' : 'blocks'}
                {result.agentConfig.agents.length > 0 ? ` · tunes ${result.agentConfig.agents.length}` : ''}
              </span>
            ) : null
          ) : (
            <>
              <span className="text-[0.5625rem] text-muted-foreground tabular-nums mr-0.5">
                {result.fragmentCount ?? 0} {result.fragmentCount === 1 ? 'fragment' : 'fragments'}
              </span>
              {(result.fragmentTypes ?? []).slice(0, 4).map((t) => (
                <Badge key={t} variant="outline" className="text-[0.5625rem] h-3.5 px-1">{t}</Badge>
              ))}
            </>
          )}
          {(result.tags ?? []).slice(0, 3).map((tag) => (
            <span key={tag} className="text-[0.5625rem] text-muted-foreground/80 px-1 rounded bg-muted/60">#{tag}</span>
          ))}
        </div>
      </div>
    </button>
  )
}

function PackDetailView({
  pack,
  storyId,
  target,
  onTargetChange,
  installResult,
  installing,
  onInstall,
}: {
  pack: ErratanetPackDetail
  storyId?: string
  target: InstallTarget
  onTargetChange: (target: InstallTarget) => void
  installResult: { ok: boolean; message: string } | null
  installing: boolean
  onInstall: () => void
}) {
  const isStory = pack.contentKind === 'story'
  const idParts = useMemo(() => parseGlobalPackId(pack.id), [pack.id])
  const canChooseTarget = !isStory && !!storyId
  const installed = installResult?.ok === true

  return (
    <>
      <ScrollArea className="flex-1" data-component-id="erratanet-detail-scroll">
        <div className="max-w-2xl mx-auto p-6 space-y-5">
          {/* Pack header */}
          <div className="flex items-start gap-4">
            <div className="size-16 shrink-0 rounded-md border border-border/30 bg-muted overflow-hidden flex items-center justify-center">
              {pack.thumbnail ? (
                <img src={pack.thumbnail} alt="" className="size-full object-cover" />
              ) : isStory ? (
                <BookOpen className="size-6 text-muted-foreground" />
              ) : (
                <Package className="size-6 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display text-xl leading-tight">{pack.title}</h3>
                <Badge variant="secondary" className="text-[0.625rem] h-4">{isStory ? 'story' : 'pack'}</Badge>
                {pack.nsfw && (
                  <Badge className="text-[0.625rem] h-4 bg-destructive/15 text-destructive border-transparent">nsfw</Badge>
                )}
              </div>
              <p className="text-[0.6875rem] font-mono text-muted-foreground mt-1">
                {pack.publisher ?? (idParts ? `@${idParts.handle}` : pack.id)}
                {idParts ? `/${idParts.slug}` : ''}
                {' '}<span className="text-muted-foreground/70">v{pack.version}</span>
              </p>
              {pack.description && (
                <p className="text-sm text-foreground/80 leading-relaxed mt-2">{pack.description}</p>
              )}
            </div>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Meta label="Contents">
              {pack.fragmentCount ?? 0} {pack.fragmentCount === 1 ? 'fragment' : 'fragments'}
            </Meta>
            <Meta label="License">{pack.license || 'unspecified'}</Meta>
          </div>

          {(pack.fragmentTypes?.length ?? 0) > 0 && (
            <div>
              <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground mb-1.5 block">
                Fragment types
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(pack.fragmentTypes ?? []).map((t) => (
                  <Badge key={t} variant="outline" className="text-[0.625rem] h-5">{t}</Badge>
                ))}
              </div>
            </div>
          )}

          {(pack.tags?.length ?? 0) > 0 && (
            <div>
              <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground mb-1.5 block">Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {(pack.tags ?? []).map((tag) => (
                  <span key={tag} className="text-[0.6875rem] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/60">#{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Trust note: MVP packs carry fragments + assets only. */}
          <div className="flex items-start gap-2 rounded-md border border-border/30 bg-accent/10 px-3 py-2">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
              Packs install fragments and assets only. Context configuration and scripts are never imported.
            </p>
          </div>

          {/* Install target */}
          <div>
            <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground mb-1.5 block">Install to</span>
            {isStory ? (
              <p className="text-xs text-muted-foreground">Stories always install as a new story.</p>
            ) : canChooseTarget ? (
              <div className="grid grid-cols-2 gap-2">
                <TargetOption
                  active={target === 'this-story'}
                  title="This story"
                  subtitle="Add fragments here"
                  onClick={() => onTargetChange('this-story')}
                />
                <TargetOption
                  active={target === 'new-story'}
                  title="New story"
                  subtitle="Create a fresh story"
                  onClick={() => onTargetChange('new-story')}
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Fragments install into a new story.</p>
            )}
          </div>

          {installResult && (
            <div className={`text-sm rounded-md p-3 ${installResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
              {installResult.message}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/50">
        <Button onClick={onInstall} disabled={installing || installed} className="gap-1.5">
          {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {installed ? 'Installed' : isStory ? 'Install as new story' : target === 'new-story' ? 'Install as new story' : 'Install into this story'}
        </Button>
      </div>
    </>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/30 px-3 py-2">
      <span className="text-[0.5625rem] uppercase tracking-wider text-muted-foreground block">{label}</span>
      <span className="text-foreground/90">{children}</span>
    </div>
  )
}

function TargetOption({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-md border px-3 py-2 transition-colors ${
        active ? 'border-primary/40 bg-primary/10' : 'border-border/40 hover:bg-accent/30'
      }`}
    >
      <span className="text-sm block leading-tight">{title}</span>
      <span className="text-[0.6875rem] text-muted-foreground">{subtitle}</span>
    </button>
  )
}
