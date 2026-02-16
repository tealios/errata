import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment, type FragmentVersion } from '@/lib/api'
import { componentId, fragmentComponentId } from '@/lib/dom-ids'
import { parseVisualRefs, readImageUrl, type BoundaryBox } from '@/lib/fragment-visuals'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Pin, Trash2, X, Monitor, User, Upload, ImagePlus, Link2, Unlink, Crop, Archive, Undo2, Copy, Check, Sparkles } from 'lucide-react'
import { RefinementPanel } from '@/components/refinement/RefinementPanel'
import { copyFragmentToClipboard } from '@/lib/fragment-clipboard'
import { CropDialog } from '@/components/fragments/CropDialog'

export interface FragmentPrefill {
  name: string
  description: string
  content: string
}

interface FragmentEditorProps {
  storyId: string
  fragment: Fragment | null
  mode: 'view' | 'edit' | 'create'
  createType?: string
  prefill?: FragmentPrefill | null
  onClose: () => void
  onSaved: (created?: Fragment) => void
}

export function FragmentEditor({
  storyId,
  fragment: fragmentProp,
  mode,
  createType,
  prefill,
  onClose,
  onSaved,
}: FragmentEditorProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState(createType ?? 'prose')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showRefine, setShowRefine] = useState(false)
  const [previewVersion, setPreviewVersion] = useState<FragmentVersion | null>(null)

  // Fetch live fragment data so sticky/placement updates are reflected immediately
  const { data: liveFragment } = useQuery({
    queryKey: ['fragment', storyId, fragmentProp?.id],
    queryFn: () => api.fragments.get(storyId, fragmentProp!.id),
    enabled: !!fragmentProp?.id,
    initialData: fragmentProp ?? undefined,
  })

  const fragment = liveFragment ?? fragmentProp
  const isVersionedType = !!fragment && ['prose', 'character', 'guideline', 'knowledge'].includes(fragment.type)

  // Media queries for clipboard copy (embed attached images)
  const { data: _imageFragments } = useQuery({
    queryKey: ['fragments', storyId, 'image'],
    queryFn: () => api.fragments.list(storyId, 'image'),
  })
  const { data: _iconFragments } = useQuery({
    queryKey: ['fragments', storyId, 'icon'],
    queryFn: () => api.fragments.list(storyId, 'icon'),
  })
  const mediaById = useMemo(() => {
    const map = new Map<string, Fragment>()
    for (const f of _imageFragments ?? []) map.set(f.id, f)
    for (const f of _iconFragments ?? []) map.set(f.id, f)
    return map
  }, [_imageFragments, _iconFragments])

  const { data: versionData } = useQuery({
    queryKey: ['fragment-versions', storyId, fragment?.id],
    queryFn: () => api.fragments.listVersions(storyId, fragment!.id),
    enabled: !!fragment?.id && isVersionedType,
  })

  // Sync local state from the source fragment (prop or live query data).
  // Uses liveFragment so that external updates (e.g. refinement agent) are reflected.
  const sourceFragment = liveFragment ?? fragmentProp
  useEffect(() => {
    if (sourceFragment) {
      setName(sourceFragment.name)
      setDescription(sourceFragment.description)
      setContent(sourceFragment.content)
      setType(sourceFragment.type)
    } else {
      setName(prefill?.name ?? '')
      setDescription(prefill?.description ?? '')
      setContent(prefill?.content ?? '')
      setType(createType ?? 'prose')
    }
  }, [sourceFragment, createType, prefill])

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    await queryClient.invalidateQueries({ queryKey: ['fragments-archived', storyId] })
    await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
    if (fragment?.id) {
      await queryClient.invalidateQueries({ queryKey: ['fragment', storyId, fragment.id] })
    }
  }

  const createMutation = useMutation({
    mutationFn: (data: { type: string; name: string; description: string; content: string }) =>
      api.fragments.create(storyId, data),
    onSuccess: (created) => {
      invalidate()
      onSaved(created)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description: string; content: string }) =>
      api.fragments.update(storyId, fragment!.id, data),
    onSuccess: () => {
      invalidate()
      onSaved()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.fragments.delete(storyId, fragment!.id),
    onSuccess: () => {
      invalidate()
      onClose()
    },
  })

  const archiveMutation = useMutation({
    mutationFn: () => api.fragments.archive(storyId, fragment!.id),
    onSuccess: () => {
      invalidate()
      onClose()
    },
  })

  const restoreMutation = useMutation({
    mutationFn: () => api.fragments.restore(storyId, fragment!.id),
    onSuccess: () => {
      invalidate()
    },
  })

  const stickyMutation = useMutation({
    mutationFn: (sticky: boolean) =>
      api.fragments.toggleSticky(storyId, fragment!.id, sticky),
    onSuccess: () => {
      invalidate()
    },
  })

  const placementMutation = useMutation({
    mutationFn: (placement: 'system' | 'user') =>
      api.fragments.setPlacement(storyId, fragment!.id, placement),
    onSuccess: () => {
      invalidate()
    },
  })

  const revertVersionMutation = useMutation({
    mutationFn: (version: number) => api.fragments.revertToVersion(storyId, fragment!.id, version),
    onSuccess: () => {
      invalidate()
      if (fragment?.id) {
        queryClient.invalidateQueries({ queryKey: ['fragment-versions', storyId, fragment.id] })
      }
    },
  })

  const versions = (versionData?.versions ?? []).slice().sort((a, b) => b.version - a.version)

  const versionDiffLines = useMemo(() => {
    if (!fragment || !previewVersion) return [] as string[]
    const current = fragment.content.split('\n')
    const target = previewVersion.content.split('\n')
    const max = Math.max(current.length, target.length)
    const out: string[] = []
    for (let i = 0; i < max; i += 1) {
      const a = current[i]
      const b = target[i]
      if (a === b) {
        if (a !== undefined) out.push(`  ${a}`)
        continue
      }
      if (a !== undefined) out.push(`- ${a}`)
      if (b !== undefined) out.push(`+ ${b}`)
    }
    return out
  }, [fragment, previewVersion])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'create') {
      createMutation.mutate({ type, name, description, content })
    } else {
      updateMutation.mutate({ name, description, content })
    }
  }

  const isEditing = mode === 'edit' || mode === 'create'
  const isPending = createMutation.isPending || updateMutation.isPending
  const isMediaType = type === 'image' || type === 'icon'

  const handleImageUpload = async (file: File) => {
    try {
      setUploadError(null)
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('Failed to read image file'))
        reader.readAsDataURL(file)
      })
      setContent(dataUrl)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not upload image')
    }
  }

  const mediaPreviewUrl = isMediaType
    ? readImageUrl({
      id: fragment?.id ?? 'preview',
      type,
      name,
      description,
      content,
      tags: fragment?.tags ?? [],
      refs: fragment?.refs ?? [],
      sticky: fragment?.sticky ?? false,
      placement: fragment?.placement ?? 'user',
      createdAt: fragment?.createdAt ?? '',
      updatedAt: fragment?.updatedAt ?? '',
      order: fragment?.order ?? 0,
      meta: fragment?.meta ?? {},
      archived: fragment?.archived ?? false,
    })
    : null

  return (
    <div className="flex flex-col h-full" data-component-id="fragment-editor-root">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 gap-2 border-b border-border/50" data-component-id={componentId('fragment-editor', mode)}>
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="font-display text-lg truncate">
            {mode === 'create' ? 'New Fragment' : fragment?.name ?? ''}
          </h2>
          {fragment && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-mono text-muted-foreground/40 hidden sm:inline">{fragment.id}</span>
              <Badge variant="secondary" className="text-[10px] h-4">{fragment.type}</Badge>
              {fragment.sticky && (
                <Badge className="text-[10px] h-4 gap-0.5">
                  <Pin className="size-2" />
                  pinned
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 overflow-x-auto">
          {fragment && mode !== 'create' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={async () => {
                    await copyFragmentToClipboard(fragment, mediaById)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  data-component-id={fragmentComponentId(fragment, 'copy-clipboard')}
                >
                  {copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Copy fragment to clipboard</TooltipContent>
            </Tooltip>
          )}
          {fragment && !fragment.archived && mode !== 'create' && fragment.type !== 'prose' && fragment.type !== 'image' && fragment.type !== 'icon' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={showRefine ? 'secondary' : 'ghost'}
                  className="h-7 text-xs gap-1"
                  onClick={() => setShowRefine(!showRefine)}
                >
                  <Sparkles className="size-3" />
                  Refine
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refine this fragment with Librarian</TooltipContent>
            </Tooltip>
          )}
          {fragment && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={() => stickyMutation.mutate(!fragment.sticky)}
                  disabled={stickyMutation.isPending}
                  data-component-id={fragmentComponentId(fragment, 'sticky-toggle')}
                >
                  <Pin className="size-3" />
                  {fragment.sticky ? 'Unpin' : 'Pin'}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{fragment.sticky ? 'Remove from context' : 'Always include in context'}</TooltipContent>
            </Tooltip>
          )}
          {fragment && fragment.sticky && fragment.type !== 'prose' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={() => placementMutation.mutate(fragment.placement === 'system' ? 'user' : 'system')}
                  disabled={placementMutation.isPending}
                  data-component-id={fragmentComponentId(fragment, 'placement-toggle')}
                >
                  {fragment.placement === 'system' ? <Monitor className="size-3" /> : <User className="size-3" />}
                  {fragment.placement === 'system' ? 'System' : 'User'}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{fragment.placement === 'system' ? 'Placed in system context' : 'Placed in user context'}</TooltipContent>
            </Tooltip>
          )}
          {fragment && !fragment.archived && mode !== 'create' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    if (confirm('Archive this fragment?')) {
                      archiveMutation.mutate()
                    }
                  }}
                  disabled={archiveMutation.isPending}
                >
                  <Archive className="size-3" />
                  Archive
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Move to archive</TooltipContent>
            </Tooltip>
          )}
          {fragment && fragment.archived && mode !== 'create' && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1"
                    onClick={() => restoreMutation.mutate()}
                    disabled={restoreMutation.isPending}
                  >
                    <Undo2 className="size-3" />
                    Restore
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Restore from archive</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1 text-destructive/70 hover:text-destructive"
                    onClick={() => {
                      if (confirm('Permanently delete this fragment? This cannot be undone.')) {
                        deleteMutation.mutate()
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Permanently delete</TooltipContent>
              </Tooltip>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" className="size-7 text-muted-foreground/50" onClick={onClose} data-component-id="fragment-editor-close">
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Close</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {showRefine && fragment && (
        <div className="px-6 py-3 border-b border-border/30">
          <RefinementPanel
            storyId={storyId}
            fragmentId={fragment.id}
            fragmentName={fragment.name}
            onComplete={() => {
              invalidate()
            }}
            onClose={() => setShowRefine(false)}
          />
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
        <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4">
          {mode === 'create' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-md border border-border/50 bg-transparent px-3 py-2 text-sm"
                data-component-id="fragment-editor-type-select"
              >
                <option value="prose">Prose</option>
                <option value="character">Character</option>
                <option value="guideline">Guideline</option>
                <option value="knowledge">Knowledge</option>
                <option value="image">Image</option>
                <option value="icon">Icon</option>
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isEditing}
              className="bg-transparent"
              required
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
              Description <span className="normal-case tracking-normal text-muted-foreground/50">(max 50 chars)</span>
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={50}
              disabled={!isEditing}
              className="bg-transparent"
              required
            />
          </div>
        </div>

        <div className="h-px bg-border/30 mx-6" />

        <div className="flex-1 px-6 py-5">
          {isMediaType ? (
            <>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
                {type === 'icon' ? 'Icon' : 'Image'}
              </label>
              {mediaPreviewUrl ? (
                <div className="space-y-2">
                  <div className="rounded-lg border border-border/40 overflow-hidden bg-muted/20">
                    <img
                      src={mediaPreviewUrl}
                      alt={name || 'Preview'}
                      className="w-full h-auto object-contain max-h-64"
                    />
                  </div>
                  {isEditing && (
                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/40 text-xs text-muted-foreground hover:bg-accent/50 cursor-pointer transition-colors">
                        <Upload className="size-3" />
                        Replace
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) void handleImageUpload(file)
                          }}
                        />
                      </label>
                      <span className="text-[10px] text-muted-foreground/40">or paste a URL below</span>
                    </div>
                  )}
                  {isEditing && (
                    <Input
                      value={content.startsWith('data:') ? '' : content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="https://example.com/image.png"
                      className="h-7 text-xs bg-transparent font-mono"
                    />
                  )}
                </div>
              ) : (
                <label
                  className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border/50 py-12 transition-colors ${
                    isEditing ? 'hover:border-primary/40 hover:bg-accent/30 cursor-pointer' : ''
                  }`}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const file = e.dataTransfer.files[0]
                    if (file && file.type.startsWith('image/')) void handleImageUpload(file)
                  }}
                >
                  <ImagePlus className="size-8 text-muted-foreground/30" />
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground/60">
                      {isEditing ? 'Drop an image here or click to upload' : 'No image set'}
                    </p>
                    <p className="text-[11px] text-muted-foreground/40 mt-1">PNG, JPG, SVG, or paste a URL</p>
                  </div>
                  {isEditing && (
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void handleImageUpload(file)
                      }}
                    />
                  )}
                </label>
              )}
              {!mediaPreviewUrl && isEditing && (
                <Input
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="https://example.com/image.png"
                  className="mt-2 h-7 text-xs bg-transparent font-mono"
                />
              )}
              {uploadError && <p className="text-[11px] text-destructive mt-1">{uploadError}</p>}
            </>
          ) : (
            <>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">Content</label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={!isEditing}
                className="min-h-[200px] h-full resize-none font-mono text-sm bg-transparent"
                required
              />
              <div className="flex justify-end gap-3 mt-1 text-[10px] text-muted-foreground/40 tabular-nums">
                <span>{content.trim() ? content.trim().split(/\s+/).length : 0} words</span>
                <span>{content.length} chars</span>
              </div>
            </>
          )}
        </div>

        {/* Tags & Refs section */}
        {fragment && (
          <>
            {isVersionedType && (
              <>
                <div className="h-px bg-border/30 mx-6" />
                <div className="px-6 py-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Version history</p>
                    <span className="text-[10px] text-muted-foreground/50">Current v{fragment.version ?? 1}</span>
                  </div>
                  {versions.length === 0 ? (
                    <p className="text-xs text-muted-foreground/50">No previous versions yet.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-auto pr-1">
                      {versions.map((v: FragmentVersion) => (
                        <div key={v.version} className="flex items-center justify-between rounded-md border border-border/40 px-2 py-1.5">
                          <div className="min-w-0">
                            <p className="text-xs font-medium">v{v.version}</p>
                            <p className="text-[10px] text-muted-foreground/50 truncate">{new Date(v.createdAt).toLocaleString()}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={() => setPreviewVersion(v)}
                            >
                              Preview
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={() => revertVersionMutation.mutate(v.version)}
                              disabled={revertVersionMutation.isPending}
                            >
                              Restore
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {previewVersion && (
                    <div className="mt-2 space-y-2 rounded-md border border-border/40 bg-muted/20 p-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium">Diff preview for v{previewVersion.version}</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => setPreviewVersion(null)}
                        >
                          Close
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground/60">`-` current content, `+` selected version</p>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border/30 bg-background/50 p-2 text-[11px] leading-4">
                        {versionDiffLines.join('\n') || 'No content differences.'}
                      </pre>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="h-px bg-border/30 mx-6" />
            <div className="px-6 py-5 space-y-5">
              <TagsSection storyId={storyId} fragmentId={fragment.id} />
              <RefsSection storyId={storyId} fragmentId={fragment.id} />
              {fragment.type !== 'image' && fragment.type !== 'icon' && (
                <VisualRefsSection storyId={storyId} fragmentId={fragment.id} />
              )}
            </div>
          </>
        )}

        {isEditing && (
          <div className="flex items-center gap-2 px-6 py-4 border-t border-border/50">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        )}
      </form>
    </div>
  )
}

function VisualRefsSection({ storyId, fragmentId }: { storyId: string; fragmentId: string }) {
  const queryClient = useQueryClient()
  const [cropTarget, setCropTarget] = useState<{
    fragmentId: string
    kind: 'icon' | 'image'
    url: string
    name: string
    boundary?: BoundaryBox
  } | null>(null)

  const { data: currentFragment } = useQuery({
    queryKey: ['fragment', storyId, fragmentId],
    queryFn: () => api.fragments.get(storyId, fragmentId),
  })

  const { data: imageFragments } = useQuery({
    queryKey: ['fragments', storyId, 'image'],
    queryFn: () => api.fragments.list(storyId, 'image'),
  })

  const { data: iconFragments } = useQuery({
    queryKey: ['fragments', storyId, 'icon'],
    queryFn: () => api.fragments.list(storyId, 'icon'),
  })

  const media = [...(iconFragments ?? []), ...(imageFragments ?? [])]
  const visualRefs = parseVisualRefs(currentFragment?.meta)
  const mediaById = new Map(media.map((m) => [m.id, m]))

  const saveMutation = useMutation({
    mutationFn: (nextRefs: Array<{ fragmentId: string; kind: 'image' | 'icon'; boundary?: BoundaryBox }>) => {
      if (!currentFragment) throw new Error('Fragment not loaded')
      return api.fragments.update(storyId, fragmentId, {
        name: currentFragment.name,
        description: currentFragment.description,
        content: currentFragment.content,
        sticky: currentFragment.sticky,
        order: currentFragment.order,
        placement: currentFragment.placement,
        meta: {
          ...currentFragment.meta,
          visualRefs: nextRefs,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragment', storyId, fragmentId] })
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    },
  })

  const [uploading, setUploading] = useState(false)

  const handleUploadAndLink = async (file: File) => {
    if (!currentFragment) return
    setUploading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
      const created = await api.fragments.create(storyId, {
        type: 'image',
        name: file.name.replace(/\.[^.]+$/, ''),
        description: file.name.slice(0, 250),
        content: dataUrl,
      })
      const nextRefs = [
        ...visualRefs,
        { fragmentId: created.id, kind: 'image' as const },
      ]
      await api.fragments.update(storyId, fragmentId, {
        name: currentFragment.name,
        description: currentFragment.description,
        content: currentFragment.content,
        sticky: currentFragment.sticky,
        order: currentFragment.order,
        placement: currentFragment.placement,
        meta: { ...currentFragment.meta, visualRefs: nextRefs },
      })
      queryClient.invalidateQueries({ queryKey: ['fragment', storyId, fragmentId] })
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
    } catch {
      // silently ignored
    } finally {
      setUploading(false)
    }
  }

  // Single click to link — no intermediate selection step
  const handleQuickLink = (mediaId: string, kind: 'icon' | 'image') => {
    const nextRefs = [...visualRefs, { fragmentId: mediaId, kind }]
    saveMutation.mutate(nextRefs)
  }

  const handleRemove = (targetId: string, targetKind: 'icon' | 'image') => {
    const nextRefs = visualRefs.filter((r) => !(r.fragmentId === targetId && r.kind === targetKind))
    saveMutation.mutate(nextRefs)
  }

  const handleCropApply = (boundary: BoundaryBox | undefined) => {
    if (!cropTarget) return
    const nextRefs = visualRefs.map((r) =>
      r.fragmentId === cropTarget.fragmentId && r.kind === cropTarget.kind
        ? { ...r, boundary }
        : r
    )
    saveMutation.mutate(nextRefs)
    setCropTarget(null)
  }

  const unlinkedMedia = media.filter((m) => !visualRefs.some((r) => r.fragmentId === m.id))

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">Visual</label>

      {/* Linked visuals — with inline crop & unlink */}
      {visualRefs.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {visualRefs.map((ref) => {
            const m = mediaById.get(ref.fragmentId)
            const url = m ? readImageUrl(m) : null
            return (
              <div key={`${ref.kind}:${ref.fragmentId}`} className="flex items-center gap-2 rounded-md border border-border/40 p-1.5 group">
                {url ? (
                  <img src={url} alt="" className="size-8 rounded object-cover bg-muted/30 shrink-0" />
                ) : (
                  <div className="size-8 rounded bg-muted/30 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{m?.name ?? ref.fragmentId}</p>
                  <p className="text-[10px] text-muted-foreground/50">
                    {ref.kind}
                    {ref.boundary && (
                      <span className="ml-1 text-muted-foreground/30">
                        crop {Math.round(ref.boundary.width * 100)}% &times; {Math.round(ref.boundary.height * 100)}%
                      </span>
                    )}
                  </p>
                </div>
                {url && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-foreground transition-all"
                        onClick={() => setCropTarget({
                          fragmentId: ref.fragmentId,
                          kind: ref.kind,
                          url,
                          name: m?.name ?? ref.fragmentId,
                          boundary: ref.boundary,
                        })}
                      >
                        <Crop className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Set crop region</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all"
                      onClick={() => handleRemove(ref.fragmentId, ref.kind)}
                      disabled={saveMutation.isPending}
                    >
                      <Unlink className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Unlink</TooltipContent>
                </Tooltip>
              </div>
            )
          })}
        </div>
      )}

      {visualRefs.length === 0 && unlinkedMedia.length === 0 && (
        <p className="text-xs text-muted-foreground/40 italic mb-2">No image or icon linked</p>
      )}

      {/* Available media — click to instantly link */}
      {unlinkedMedia.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
          {unlinkedMedia.map((m) => {
            const url = readImageUrl(m)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleQuickLink(m.id, m.type as 'icon' | 'image')}
                disabled={saveMutation.isPending}
                className="relative rounded-md border border-border/40 overflow-hidden aspect-square transition-all hover:border-primary/50 hover:ring-1 hover:ring-primary/20 group/tile"
                title={`Click to link ${m.name}`}
              >
                {url ? (
                  <img src={url} alt={m.name} className="size-full object-cover bg-muted/20" />
                ) : (
                  <div className="size-full bg-muted/30 flex items-center justify-center">
                    <ImagePlus className="size-4 text-muted-foreground/30" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/tile:bg-black/40 transition-colors">
                  <Link2 className="size-3.5 text-white opacity-0 group-hover/tile:opacity-100 transition-opacity" />
                </div>
              </button>
            )
          })}
          {/* Upload tile */}
          <label className={`rounded-md border-2 border-dashed border-border/40 aspect-square flex flex-col items-center justify-center gap-0.5 transition-colors ${uploading ? 'opacity-50' : 'hover:border-primary/40 hover:bg-accent/30 cursor-pointer'}`}>
            <Upload className="size-4 text-muted-foreground/40" />
            <span className="text-[9px] text-muted-foreground/40">{uploading ? 'Uploading' : 'Upload'}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleUploadAndLink(file)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )}

      {/* Upload-only button when no unlinked media to show in grid */}
      {unlinkedMedia.length === 0 && (
        <label className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md border text-xs cursor-pointer transition-colors ${uploading ? 'opacity-50 pointer-events-none' : 'border-border/40 hover:bg-accent/50'}`}>
          <Upload className="size-3" />
          {uploading ? 'Uploading...' : 'Upload & link'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleUploadAndLink(file)
              e.target.value = ''
            }}
          />
        </label>
      )}

      {/* Crop dialog — opened from linked visual's crop button */}
      {cropTarget && (
        <CropDialog
          open={true}
          onOpenChange={(open) => { if (!open) setCropTarget(null) }}
          imageUrl={cropTarget.url}
          imageName={cropTarget.name}
          initialBoundary={cropTarget.boundary}
          onApply={handleCropApply}
        />
      )}
    </div>
  )
}

// --- Tags sub-component ---

function TagsSection({ storyId, fragmentId }: { storyId: string; fragmentId: string }) {
  const queryClient = useQueryClient()
  const [newTag, setNewTag] = useState('')

  const { data } = useQuery({
    queryKey: ['tags', storyId, fragmentId],
    queryFn: () => api.fragments.getTags(storyId, fragmentId),
  })

  const addMutation = useMutation({
    mutationFn: (tag: string) => api.fragments.addTag(storyId, fragmentId, tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags', storyId, fragmentId] })
      setNewTag('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (tag: string) => api.fragments.removeTag(storyId, fragmentId, tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags', storyId, fragmentId] })
    },
  })

  const handleAddTag = () => {
    const tag = newTag.trim().toLowerCase()
    if (tag && !data?.tags.includes(tag)) {
      addMutation.mutate(tag)
    }
  }

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">Tags</label>
      <div className="flex flex-wrap gap-1 mb-2">
        {data?.tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs gap-1">
            {tag}
            <button
              type="button"
              onClick={() => removeMutation.mutate(tag)}
              className="ml-0.5 hover:text-destructive transition-colors"
            >
              &times;
            </button>
          </Badge>
        ))}
        {(!data?.tags || data.tags.length === 0) && (
          <span className="text-xs text-muted-foreground/40 italic">No tags</span>
        )}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          placeholder="Add tag..."
          className="h-7 text-xs bg-transparent"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddTag()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={handleAddTag}
          disabled={!newTag.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

// --- Refs sub-component ---

function RefsSection({ storyId, fragmentId }: { storyId: string; fragmentId: string }) {
  const queryClient = useQueryClient()
  const [newRefId, setNewRefId] = useState('')

  const { data } = useQuery({
    queryKey: ['refs', storyId, fragmentId],
    queryFn: () => api.fragments.getRefs(storyId, fragmentId),
  })

  const addMutation = useMutation({
    mutationFn: (targetId: string) => api.fragments.addRef(storyId, fragmentId, targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['refs', storyId, fragmentId] })
      setNewRefId('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (targetId: string) => api.fragments.removeRef(storyId, fragmentId, targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['refs', storyId, fragmentId] })
    },
  })

  const handleAddRef = () => {
    const id = newRefId.trim()
    if (id && !data?.refs.includes(id)) {
      addMutation.mutate(id)
    }
  }

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">References</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {data?.refs.map((refId) => (
          <Badge key={refId} variant="outline" className="text-xs gap-1">
            {refId}
            <button
              type="button"
              onClick={() => removeMutation.mutate(refId)}
              className="ml-0.5 hover:text-destructive transition-colors"
            >
              &times;
            </button>
          </Badge>
        ))}
        {(!data?.refs || data.refs.length === 0) && (
          <span className="text-xs text-muted-foreground/40 italic">No refs</span>
        )}
      </div>
      {data?.backRefs && data.backRefs.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          <span className="text-xs text-muted-foreground/50">Referenced by:</span>
          {data.backRefs.map((refId) => (
            <Badge key={refId} variant="secondary" className="text-[10px]">
              {refId}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-1.5 mt-1.5">
        <Input
          value={newRefId}
          onChange={(e) => setNewRefId(e.target.value)}
          placeholder="Fragment ID (e.g. ch-bokura)"
          className="h-7 text-xs bg-transparent"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddRef()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={handleAddRef}
          disabled={!newRefId.trim()}
        >
          Link
        </Button>
      </div>
    </div>
  )
}
