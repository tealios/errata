import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import type { ErratapackManifest } from '@/lib/erratanet/pack-schema'
import { GLOBAL_PACK_ID_REGEX, packPageUrl } from '@/lib/erratanet/pack-schema'
import { serializeBundle } from '@/lib/fragment-clipboard'
import { parseVisualRefs } from '@/lib/fragment-visuals'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  UploadCloud,
  Loader2,
  Check,
  AlertTriangle,
  X,
  ExternalLink,
  Image as ImageIcon,
} from 'lucide-react'

interface PublishPackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 'fragments' publishes the selection; 'story' publishes the whole story. */
  mode?: 'fragments' | 'story'
  /** Required for story mode: the story to publish whole. */
  storyId?: string
  /** Pre-fill the slug (used by "sync" to re-publish to the same pack). */
  defaultSlug?: string
  /** The guideline / character / knowledge fragments to publish. */
  selectedFragments: Fragment[]
  /** Image + icon fragments by id, for resolving attachments and thumbnails. */
  mediaById: Map<string, Fragment>
  storyName?: string
}

const LICENSES = [
  { value: 'CC0-1.0', label: 'CC0 1.0 (public domain)' },
  { value: 'CC-BY-4.0', label: 'CC BY 4.0 (attribution)' },
  { value: 'CC-BY-SA-4.0', label: 'CC BY-SA 4.0 (share-alike)' },
  { value: 'CC-BY-NC-4.0', label: 'CC BY-NC 4.0 (non-commercial)' },
  { value: 'proprietary', label: 'Proprietary (all rights reserved)' },
] as const

type BumpKind = 'patch' | 'minor' | 'major'

type ContentRating = 'general' | 'mature' | 'r18'

const CONTENT_RATINGS: { value: ContentRating; label: string; hint: string }[] = [
  { value: 'general', label: 'General', hint: 'Suitable for everyone.' },
  { value: 'mature', label: 'Mature', hint: 'Mature themes; not explicit.' },
  { value: 'r18', label: 'R18', hint: 'Explicit adult content. Marked NSFW.' },
]

const README_MAX = 8000

const sectionLabel =
  'text-[0.5625rem] text-muted-foreground uppercase tracking-[0.15em] font-medium mb-2'

/** Increment a semver core (major.minor.patch). Falls back to 1.0.0 on garbage. */
/** Derive a pack slug from a title: lowercase, dashes, trimmed. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function bumpVersion(latest: string | null | undefined, kind: BumpKind): string {
  if (!latest) return '1.0.0'
  const core = latest.split(/[-+]/)[0]
  const parts = core.split('.').map((n) => Number.parseInt(n, 10))
  let [major, minor, patch] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
  if (kind === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (kind === 'minor') {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }
  return `${major}.${minor}.${patch}`
}

/** Browser SHA-256 over a UTF-8 string, formatted as `sha256:<hex>`. */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256:${hex}`
}

export function PublishPackDialog({
  open,
  onOpenChange,
  mode = 'fragments',
  storyId,
  defaultSlug,
  selectedFragments,
  mediaById,
  storyName,
}: PublishPackDialogProps) {
  const isStory = mode === 'story'
  const qc = useQueryClient()
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [readme, setReadme] = useState('')
  const [license, setLicense] = useState<string>(LICENSES[1].value)
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [contentRating, setContentRating] = useState<ContentRating>('general')
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public')
  const [bump, setBump] = useState<BumpKind>('patch')
  const [thumbnailId, setThumbnailId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [publishedId, setPublishedId] = useState<string | null>(null)

  // Resolve the signed-in handle. New packs need it to form the @handle/slug id.
  const { data: account } = useQuery({
    queryKey: ['erratanet-account'],
    queryFn: () => api.erratanet.getAccount(),
    enabled: open,
  })
  // The configured hub, used to build a hotlink to the published pack's page.
  const { data: config } = useQuery({
    queryKey: ['erratanet-config'],
    queryFn: () => api.erratanet.getConfig(),
    enabled: open,
  })
  const handle = account?.handle ?? null
  // The slug falls back to one derived from the title, so an empty slug still
  // yields a name.
  const derivedSlug = slugify(title)
  const effectiveSlug = slug.trim() || derivedSlug
  const packId = handle && effectiveSlug ? `@${handle}/${effectiveSlug}` : null

  // Look up the latest published version of this pack (404 -> brand new pack).
  const { data: existingPack, isFetching: checkingPack } = useQuery({
    queryKey: ['erratanet-pack', packId],
    queryFn: async () => {
      if (!packId) return null
      try {
        return await api.erratanet.getPack(packId)
      } catch {
        // Not found / unreachable: treat as a new pack.
        return null
      }
    },
    enabled: open && !!packId,
  })
  const latestVersion = existingPack?.version ?? null
  const nextVersion = useMemo(() => bumpVersion(latestVersion, bump), [latestVersion, bump])

  // Image fragments referenced by the selected fragments — thumbnail candidates.
  const thumbnailCandidates = useMemo(() => {
    const seen = new Set<string>()
    const out: Fragment[] = []
    for (const fragment of selectedFragments) {
      for (const ref of parseVisualRefs(fragment.meta)) {
        if (ref.kind !== 'image' || seen.has(ref.fragmentId)) continue
        const media = mediaById.get(ref.fragmentId)
        if (media) {
          seen.add(ref.fragmentId)
          out.push(media)
        }
      }
    }
    return out
  }, [selectedFragments, mediaById])

  // Chapters, story mode only. Walk the active prose chain (the reading order)
  // and emit a chapter for every marker it passes, so the list matches what a
  // reader sees, in order, and excludes markers no longer in the chain.
  const { data: markerFragments } = useQuery({
    queryKey: ['fragments', storyId, 'marker'],
    queryFn: () => api.fragments.list(storyId!, 'marker'),
    enabled: open && isStory && !!storyId,
  })
  const { data: chain } = useQuery({
    queryKey: ['proseChain', storyId],
    queryFn: () => api.proseChain.get(storyId!),
    enabled: open && isStory && !!storyId,
  })
  const chapters = useMemo(() => {
    const markerById = new Map((markerFragments ?? []).map((m) => [m.id, m]))
    const result: { title: string; order: number }[] = []
    for (const entry of chain?.entries ?? []) {
      const marker = markerById.get(entry.active)
      if (marker) result.push({ title: marker.name, order: result.length })
    }
    return result
  }, [chain, markerFragments])

  // Reset transient state whenever the dialog opens. A defaultSlug (sync)
  // pre-fills the pack to re-publish to.
  const seededRef = useRef(false)
  useEffect(() => {
    if (open) {
      setError(null)
      setPublishedId(null)
      setReadme('')
      setContentRating('general')
      seededRef.current = false
      if (defaultSlug) setSlug(defaultSlug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Default the title from the story name once, when empty.
  useEffect(() => {
    if (open && !title && storyName) setTitle(storyName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // When updating an existing pack (sync, or re-publishing the same slug),
  // pre-fill the metadata from its latest published manifest so the update
  // preserves tags, description, license, rating, and readme. Runs once per open.
  useEffect(() => {
    if (!open || seededRef.current) return
    const manifest = (existingPack as { manifest?: Record<string, unknown> } | null | undefined)?.manifest
    if (!manifest) return
    seededRef.current = true
    if (Array.isArray(manifest.tags)) {
      setTags(manifest.tags.filter((t): t is string => typeof t === 'string'))
    }
    if (typeof manifest.description === 'string' && manifest.description) setDescription(manifest.description)
    if (typeof manifest.license === 'string' && manifest.license) setLicense(manifest.license)
    if (typeof manifest.readme === 'string') setReadme(manifest.readme)
    if (manifest.contentRating === 'general' || manifest.contentRating === 'mature' || manifest.contentRating === 'r18') {
      setContentRating(manifest.contentRating)
    } else if (manifest.nsfw === true) {
      setContentRating('r18')
    }
    if (typeof manifest.title === 'string' && manifest.title) setTitle(manifest.title)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existingPack])

  const addTag = useCallback(() => {
    const tag = tagDraft.trim().toLowerCase()
    if (tag && !tags.includes(tag)) setTags((prev) => [...prev, tag])
    setTagDraft('')
  }, [tagDraft, tags])

  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag))
  }, [])

  const publishMut = useMutation({
    mutationFn: async () => {
      if (!handle) throw new Error('Connect a hub account in Settings first.')
      const cleanSlug = slug.trim() || slugify(title)
      if (!cleanSlug) throw new Error('Enter a title or a slug for the pack.')
      const id = `@${handle}/${cleanSlug}`
      if (!GLOBAL_PACK_ID_REGEX.test(id)) {
        throw new Error('Slug must be lowercase letters, numbers, and dashes.')
      }
      if (!title.trim()) throw new Error('Enter a title.')
      if (description.length > 250) throw new Error('Description must be 250 characters or fewer.')

      const thumbnailFragment = thumbnailId ? mediaById.get(thumbnailId) : undefined
      const trimmedReadme = readme.trim()

      // Fields shared by both content kinds. The server fills in contentKind,
      // fragment counts, and the payload hash; MVP packs carry no blockConfig /
      // agentBlockConfigs.
      const base = {
        errataPack: 1 as const,
        id,
        version: nextVersion,
        title: title.trim(),
        description: description.trim(),
        license,
        errataFormatVersion: 1,
        tags,
        // R18 implies NSFW; general / mature are not flagged (mature is a soft label).
        nsfw: contentRating === 'r18',
        contentRating,
        ...(trimmedReadme ? { readme: trimmedReadme } : {}),
        ...(thumbnailFragment ? { thumbnail: thumbnailFragment.content } : {}),
        capabilities: [] as string[],
        dependencies: [] as ErratapackManifest['dependencies'],
        ...(handle ? { publisher: `@${handle}` } : {}),
        createdAt: new Date().toISOString(),
      }

      if (isStory) {
        if (!storyId) throw new Error('No story to publish.')
        // The server derives fragmentTypes/count + payloadHash from the story zip.
        const manifest: ErratapackManifest = {
          ...base,
          contentKind: 'story',
          ...(chapters.length > 0 ? { chapters } : {}),
          fragmentTypes: [],
          fragmentCount: 0,
          payloadHash: '',
        }
        return api.erratanet.publish({ storyId, manifest, unlisted: visibility === 'unlisted' })
      }

      if (selectedFragments.length === 0) throw new Error('Select at least one fragment to publish.')
      const bundleJson = serializeBundle(selectedFragments, mediaById, storyName)
      const manifest: ErratapackManifest = {
        ...base,
        contentKind: 'fragment-pack',
        fragmentTypes: Array.from(new Set(selectedFragments.map((f) => f.type))),
        fragmentCount: selectedFragments.length,
        payloadHash: await sha256Hex(bundleJson),
      }
      return api.erratanet.publish({
        bundleJson,
        manifest,
        unlisted: visibility === 'unlisted',
        // Tie the pack to this story so the sidebar can track + re-sync it.
        ...(storyId ? { storyId, fragmentIds: selectedFragments.map((f) => f.id) } : {}),
      })
    },
    onSuccess: (res) => {
      setPublishedId(res.id)
      setError(null)
      // A story publish stamps provenance server-side; refresh so the sidebar
      // picks up the new "published as" state.
      if (storyId) {
        qc.invalidateQueries({ queryKey: ['story', storyId] })
        qc.invalidateQueries({ queryKey: ['stories'] })
      }
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : 'Publish failed.')
    },
  })

  const descOver = description.length > 250
  const canPublish =
    !!handle &&
    !!effectiveSlug &&
    !!title.trim() &&
    !descOver &&
    (isStory || selectedFragments.length > 0) &&
    !publishMut.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[88vh] flex flex-col overflow-hidden" data-component-id="publish-pack-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-lg flex items-center gap-2">
            <UploadCloud className="size-4 text-muted-foreground" />
            Publish to ErrataNet
          </DialogTitle>
          <DialogDescription>
            {isStory
              ? 'Publish this whole story: branches, prose chain, and fragments.'
              : `Share ${selectedFragments.length} fragment${selectedFragments.length !== 1 ? 's' : ''} as a reusable pack.`}
          </DialogDescription>
        </DialogHeader>

        {publishedId ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="grid size-11 place-items-center rounded-full bg-primary/10">
              <Check className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Published</p>
              <p className="mt-1 font-mono text-[0.8125rem] text-muted-foreground">{publishedId}</p>
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">version {nextVersion}</p>
            </div>
            {(() => {
              const packUrl = packPageUrl(config?.hubUrl, publishedId)
              return packUrl ? (
                <a
                  href={packUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/40 px-3 py-1.5 text-[0.75rem] text-foreground/80 transition-colors hover:border-border hover:text-foreground"
                >
                  View on ErrataNet
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null
            })()}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-5 py-1 pr-1">
            {/* Account notice */}
            {!handle && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500/80" />
                <p className="text-[0.6875rem] leading-snug text-amber-600/80 dark:text-amber-400/80">
                  No hub account connected. Sign in from the ErrataNet panel before publishing.
                </p>
              </div>
            )}

            {/* Slug */}
            <div>
              <h4 className={sectionLabel}>Slug</h4>
              <div className="flex items-center gap-2">
                <span className="shrink-0 font-mono text-[0.8125rem] text-muted-foreground">
                  @{handle ?? 'handle'}/
                </span>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder={derivedSlug || 'cozy-fantasy-starter'}
                  className="h-9 font-mono"
                  autoFocus
                  data-component-id="publish-pack-slug"
                />
              </div>
            </div>

            {/* Title */}
            <div>
              <h4 className={sectionLabel}>Title</h4>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Cozy Fantasy Starter"
                maxLength={120}
                className="h-9"
                data-component-id="publish-pack-title"
              />
            </div>

            {/* Description */}
            <div>
              <div className="flex items-baseline justify-between">
                <h4 className={sectionLabel}>Description</h4>
                <span className={cn('text-[0.625rem] tabular-nums', descOver ? 'text-destructive' : 'text-muted-foreground')}>
                  {description.length}/250
                </span>
              </div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short summary of what this pack contains..."
                rows={3}
                className="text-xs resize-y min-h-16 max-h-40"
                aria-invalid={descOver}
                data-component-id="publish-pack-description"
              />
            </div>

            {/* Information (readme) */}
            <div>
              <div className="flex items-baseline justify-between">
                <h4 className={sectionLabel}>Information</h4>
                <span className="text-[0.625rem] tabular-nums text-muted-foreground">
                  {readme.length}/{README_MAX}
                </span>
              </div>
              <Textarea
                value={readme}
                onChange={(e) => setReadme(e.target.value.slice(0, README_MAX))}
                placeholder="Long-form notes, setup, credits... Markdown is supported."
                rows={4}
                className="text-xs resize-y min-h-20 max-h-56"
                data-component-id="publish-pack-readme"
              />
              <p className="mt-1.5 text-[0.625rem] text-muted-foreground">
                Shown on the pack page. Optional.
              </p>
            </div>

            {/* License */}
            <div>
              <h4 className={sectionLabel}>License</h4>
              <select
                value={license}
                onChange={(e) => setLicense(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                data-component-id="publish-pack-license"
              >
                {LICENSES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div>
              <h4 className={sectionLabel}>Tags</h4>
              {tags.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${tag}`}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addTag()
                  }
                }}
                onBlur={addTag}
                placeholder="Add a tag and press Enter"
                className="h-9"
                data-component-id="publish-pack-tags"
              />
            </div>

            {/* Chapters (story mode, derived from markers) */}
            {isStory && chapters.length > 0 && (
              <div>
                <h4 className={sectionLabel}>Chapters ({chapters.length})</h4>
                <ol className="max-h-28 overflow-y-auto rounded-md border border-border/40 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
                  {chapters.map((ch, i) => (
                    <li key={i} className="flex gap-2 py-0.5">
                      <span className="tabular-nums text-muted-foreground/60">{i + 1}.</span>
                      <span className="truncate text-foreground/80">{ch.title}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-1.5 text-[0.625rem] text-muted-foreground">
                  Derived from chapter markers. Shown on the pack page.
                </p>
              </div>
            )}

            {/* Thumbnail */}
            {thumbnailCandidates.length > 0 && (
              <div>
                <h4 className={sectionLabel}>Thumbnail</h4>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setThumbnailId(null)}
                    className={cn(
                      'grid size-14 place-items-center rounded-md border text-muted-foreground transition-colors',
                      thumbnailId === null ? 'border-primary/40 bg-primary/5 text-foreground' : 'border-border/40 hover:border-border',
                    )}
                    aria-label="No thumbnail"
                  >
                    <ImageIcon className="size-4" />
                  </button>
                  {thumbnailCandidates.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setThumbnailId(img.id)}
                      className={cn(
                        'size-14 overflow-hidden rounded-md border transition-colors',
                        thumbnailId === img.id ? 'border-primary/60 ring-2 ring-primary/30' : 'border-border/40 hover:border-border',
                      )}
                      title={img.name}
                    >
                      <img src={img.content} alt={img.name} className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Content rating */}
            <div>
              <h4 className={sectionLabel}>Content rating</h4>
              <div className="flex w-fit gap-[3px] rounded-lg bg-muted/25 p-[3px]">
                {CONTENT_RATINGS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setContentRating(r.value)}
                    className={cn(
                      'rounded-md px-3 py-[6px] text-[0.6875rem] font-medium transition-all duration-150',
                      contentRating === r.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                    data-component-id={`publish-pack-rating-${r.value}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[0.625rem] text-muted-foreground">
                {CONTENT_RATINGS.find((r) => r.value === contentRating)?.hint}
              </p>
            </div>

            {/* Visibility */}
            <div>
              <h4 className={sectionLabel}>Visibility</h4>
              <div className="flex w-fit gap-[3px] rounded-lg bg-muted/25 p-[3px]">
                {(['public', 'unlisted'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    className={cn(
                      'rounded-md px-3 py-[6px] text-[0.6875rem] font-medium capitalize transition-all duration-150',
                      visibility === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[0.625rem] text-muted-foreground">
                {visibility === 'public'
                  ? 'Listed in search and explore.'
                  : 'Hidden from search. Only people with the link can find it.'}
              </p>
            </div>

            {/* Version */}
            <div>
              <h4 className={sectionLabel}>Version</h4>
              <div className="flex items-center gap-3">
                <div className="flex rounded-lg bg-muted/25 p-[3px] gap-[3px]">
                  {(['patch', 'minor', 'major'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setBump(kind)}
                      className={cn(
                        'px-3 py-[6px] rounded-md text-[0.6875rem] font-medium capitalize transition-all duration-150',
                        bump === kind ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
                <span className="font-mono text-sm tabular-nums">{nextVersion}</span>
                {checkingPack && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
              </div>
              <p className="mt-1.5 text-[0.625rem] text-muted-foreground">
                {latestVersion ? `Latest published: ${latestVersion}` : 'New pack, starting at 1.0.0'}
              </p>
            </div>

            {/* MVP note */}
            <p className="text-[0.625rem] leading-snug text-muted-foreground">
              {isStory
                ? 'The whole story is published: branches, prose chain, fragments, and images. Context blocks and agent configuration are not included.'
                : 'Packs carry fragments and their images only. Context blocks and agent configuration are not included.'}
            </p>

            {error && <p className="text-[0.6875rem] text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter className="gap-2 pt-3 border-t border-border/30">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-xs">
            {publishedId ? 'Done' : 'Cancel'}
          </Button>
          {!publishedId && (
            <Button
              onClick={() => publishMut.mutate()}
              disabled={!canPublish}
              className="text-xs gap-1.5"
              data-component-id="publish-pack-submit"
            >
              {publishMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />}
              Publish {nextVersion}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
