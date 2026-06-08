import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment, type StoryMeta } from '@/lib/api'
import type { ErratanetAccount, ErratanetConfigResponse } from '@/lib/api/types'
import { packPageUrl } from '@/lib/erratanet/pack-schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  ArrowUpFromLine,
  AlertTriangle,
  ExternalLink,
  Library,
  Loader2,
  LogOut,
  Plug,
  Search,
  UploadCloud,
} from 'lucide-react'
import { PublishPackDialog } from './PublishPackDialog'
import { ErratanetBrowserPanel } from './ErratanetBrowserPanel'

const DEFAULT_HUB = 'https://errata.tealios.com'

/** Small uppercase block label, matching the other sidebar panels. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[0.625rem] font-medium uppercase tracking-[0.13em] text-muted-foreground">
      {children}
    </p>
  )
}

interface ErratanetPanelProps {
  storyId: string
  story: StoryMeta
  /** Opens the fragment export panel (for publishing a selection as a pack). */
  onExport?: () => void
}

/**
 * The dedicated ErrataNet sidebar panel: hub account, this-story publish/sync,
 * and a way into the pack browser. Sync is the hero once a story is published.
 */
export function ErratanetPanel({ storyId, story, onExport }: ErratanetPanelProps) {
  const qc = useQueryClient()

  const { data: config } = useQuery({
    queryKey: ['erratanet-config'],
    queryFn: () => api.erratanet.getConfig(),
  })
  const { data: account } = useQuery({
    queryKey: ['erratanet-account'],
    queryFn: () => api.erratanet.getAccount(),
    enabled: !!config?.token,
  })

  const connected = !!config?.token && !!account?.connected
  const handle = account?.handle ?? config?.handle

  // Where this story is published, if anywhere. Drives publish vs. sync.
  const publishedAs = story.settings?.erratanet?.publishedAs
  const publishedSlug = publishedAs ? publishedAs.pack.split('/')[1] : undefined
  const fragmentPacks = story.settings?.erratanet?.fragmentPacks ?? []

  const [publishOpen, setPublishOpen] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [syncPack, setSyncPack] = useState<{ pack: string; fragments: Fragment[] } | null>(null)
  const emptyMedia = useMemo<Map<string, Fragment>>(() => new Map(), [])

  // Fragments + media are needed to re-sync a fragment pack; only fetch them
  // when this story has packs to sync (the query keys are shared/cached).
  const needFragments = connected && fragmentPacks.length > 0
  const { data: allFragments = [] } = useQuery({
    queryKey: ['fragments', storyId],
    queryFn: () => api.fragments.list(storyId),
    enabled: needFragments,
  })
  const { data: imageFrags = [] } = useQuery({
    queryKey: ['fragments', storyId, 'image'],
    queryFn: () => api.fragments.list(storyId, 'image'),
    enabled: needFragments,
  })
  const { data: iconFrags = [] } = useQuery({
    queryKey: ['fragments', storyId, 'icon'],
    queryFn: () => api.fragments.list(storyId, 'icon'),
    enabled: needFragments,
  })
  const fragmentById = useMemo(() => {
    const m = new Map<string, Fragment>()
    for (const f of allFragments) m.set(f.id, f)
    return m
  }, [allFragments])
  const mediaById = useMemo(() => {
    const m = new Map<string, Fragment>()
    for (const f of imageFrags) m.set(f.id, f)
    for (const f of iconFrags) m.set(f.id, f)
    return m
  }, [imageFrags, iconFrags])

  return (
    <>
      <ScrollArea className="h-full">
        <div className="space-y-6 px-5 py-5">
          <AccountBlock config={config} connected={connected} handle={handle} qc={qc} />

          {connected && (
            <>
              <Divider />
              <section>
                <Label>This story</Label>
                {publishedAs ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border/40 bg-card/40 px-3.5 py-3">
                      <p className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                        Published as
                      </p>
                      <PackLink pack={publishedAs.pack} hubUrl={config?.hubUrl} className="mt-1 text-[0.8125rem]" />
                      <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">
                        v{publishedAs.version}
                      </p>
                    </div>
                    <Button className="w-full gap-2" onClick={() => setPublishOpen(true)}>
                      <ArrowUpFromLine className="size-4" />
                      Sync update
                    </Button>
                    <p className="text-[0.6875rem] leading-snug text-muted-foreground">
                      Publishes your current prose chain and fragments as a new version of this pack.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[0.75rem] leading-snug text-muted-foreground">
                      This story is not on the hub yet. Publishing sends the whole story: branches,
                      prose chain, and fragments.
                    </p>
                    <Button className="w-full gap-2" onClick={() => setPublishOpen(true)}>
                      <UploadCloud className="size-4" />
                      Publish story
                    </Button>
                  </div>
                )}

                {/* Fragment packs published from this story (e.g. a starter). */}
                {fragmentPacks.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                      Fragment packs
                    </p>
                    {fragmentPacks.map((fp) => {
                      const resolved = fp.fragmentIds
                        .map((id) => fragmentById.get(id))
                        .filter((f): f is Fragment => !!f)
                      const missing = fp.fragmentIds.length - resolved.length
                      return (
                        <div
                          key={fp.pack}
                          className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 px-3 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <PackLink pack={fp.pack} hubUrl={config?.hubUrl} className="text-[0.75rem]" />
                            <p className="font-mono text-[0.625rem] text-muted-foreground">
                              v{fp.version} · {resolved.length} fragment{resolved.length === 1 ? '' : 's'}
                              {missing > 0 ? ` · ${missing} missing` : ''}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 gap-1.5 px-2.5 text-[0.6875rem]"
                            disabled={resolved.length === 0}
                            onClick={() => setSyncPack({ pack: fp.pack, fragments: resolved })}
                          >
                            <ArrowUpFromLine className="size-3" />
                            Sync
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <Button
                  variant="ghost"
                  className="mt-2 h-8 w-full justify-start gap-2 px-2 text-[0.75rem] text-muted-foreground hover:text-foreground"
                  onClick={() => onExport?.()}
                >
                  <UploadCloud className="size-3.5" />
                  Publish a fragment pack instead
                </Button>
              </section>
            </>
          )}

          <Divider />
          <section>
            <Label>Discover</Label>
            <Button variant="outline" className="w-full gap-2" onClick={() => setBrowseOpen(true)}>
              <Search className="size-4" />
              Browse and Install Packs
            </Button>
            <p className="mt-2 text-[0.6875rem] leading-snug text-muted-foreground">
              Find character cards, guideline packs, and stories to install. No account needed to browse.
            </p>
          </section>
        </div>
      </ScrollArea>

      <PublishPackDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        mode="story"
        storyId={storyId}
        defaultSlug={publishedSlug}
        storyName={story.name}
        selectedFragments={[]}
        mediaById={emptyMedia}
      />

      {syncPack && (
        <PublishPackDialog
          open
          onOpenChange={(o) => {
            if (!o) setSyncPack(null)
          }}
          mode="fragments"
          storyId={storyId}
          defaultSlug={syncPack.pack.split('/')[1]}
          storyName={story.name}
          selectedFragments={syncPack.fragments}
          mediaById={mediaById}
        />
      )}

      {browseOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] bg-background"
            data-component-id="erratanet-browser-overlay"
          >
            <ErratanetBrowserPanel storyId={storyId} onClose={() => setBrowseOpen(false)} />
          </div>,
          document.body,
        )}
    </>
  )
}

function Divider() {
  return <div className="h-px bg-border/30" />
}

/**
 * A pack id rendered as a hotlink to its page on the hub, falling back to plain
 * mono text when no hub is configured (so the id is still shown).
 */
function PackLink({ pack, hubUrl, className }: { pack: string; hubUrl: string | undefined; className?: string }) {
  const url = packPageUrl(hubUrl, pack)
  if (!url) {
    return <p className={cn('truncate font-mono text-foreground', className)}>{pack}</p>
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'group inline-flex max-w-full items-center gap-1 font-mono text-foreground underline-offset-2 hover:underline',
        className,
      )}
    >
      <span className="truncate">{pack}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </a>
  )
}

/** Account connection: log in with a password, fall back to a token, or sign out. */
function AccountBlock({
  config,
  connected,
  handle,
  qc,
}: {
  config: ErratanetConfigResponse | undefined
  connected: boolean
  handle: string | undefined
  qc: ReturnType<typeof useQueryClient>
}) {
  const [hubUrl, setHubUrl] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [mode, setMode] = useState<'password' | 'token'>('password')
  const [error, setError] = useState<string | null>(null)

  const hubUrlValue = hubUrl || config?.hubUrl || DEFAULT_HUB
  const registerUrl = `${hubUrlValue.trim().replace(/\/+$/, '')}/register`
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : 'Request failed.')

  const loginMut = useMutation({
    mutationFn: (data: { hubUrl: string; identifier: string; password: string }) =>
      api.erratanet.login(data),
    onSuccess: (acct: ErratanetAccount) => {
      qc.invalidateQueries({ queryKey: ['erratanet-config'] })
      qc.setQueryData(['erratanet-account'], acct)
      setPassword('')
      setError(acct.connected ? null : acct.error ?? 'Could not log in.')
    },
    onError,
  })

  const connectMut = useMutation({
    mutationFn: async (data: { hubUrl: string; token: string }) => {
      const cfg = await api.erratanet.setConfig(data)
      const acct = await api.erratanet.getAccount()
      return { cfg, acct }
    },
    onSuccess: ({ cfg, acct }: { cfg: ErratanetConfigResponse; acct: ErratanetAccount }) => {
      qc.setQueryData(['erratanet-config'], cfg)
      qc.setQueryData(['erratanet-account'], acct)
      setToken('')
      setError(acct.connected ? null : acct.error ?? 'Could not verify the token.')
    },
    onError,
  })

  const disconnectMut = useMutation({
    mutationFn: () => api.erratanet.setConfig({ token: '' }),
    onSuccess: (cfg: ErratanetConfigResponse) => {
      qc.setQueryData(['erratanet-config'], cfg)
      qc.setQueryData(['erratanet-account'], { connected: false } satisfies ErratanetAccount)
      setToken('')
      setPassword('')
      setError(null)
    },
    onError,
  })

  const busy = loginMut.isPending || connectMut.isPending || disconnectMut.isPending

  if (connected) {
    return (
      <section>
        <Label>Account</Label>
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Library className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[0.8125rem] text-foreground">@{handle ?? 'account'}</p>
            <p className="truncate font-mono text-[0.6875rem] text-muted-foreground">
              {config?.hubUrl}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-[0.6875rem] text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={() => disconnectMut.mutate()}
          >
            {disconnectMut.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <LogOut className="size-3" />
            )}
            Sign out
          </Button>
        </div>
      </section>
    )
  }

  const submitLogin = () => {
    const url = hubUrlValue.trim()
    if (!url) return setError('Enter a hub URL.')
    if (!identifier.trim()) return setError('Enter your username or email.')
    if (!password) return setError('Enter your password.')
    setError(null)
    loginMut.mutate({ hubUrl: url, identifier: identifier.trim(), password })
  }

  const submitToken = () => {
    const url = hubUrlValue.trim()
    if (!url) return setError('Enter a hub URL.')
    if (!token.trim()) return setError('Enter an access token.')
    setError(null)
    connectMut.mutate({ hubUrl: url, token: token.trim() })
  }

  return (
    <section>
      <Label>Account</Label>
      <p className="mb-3 text-[0.75rem] leading-snug text-muted-foreground">
        Sign in to publish your stories and packs to the hub.
      </p>

      <div className="space-y-2">
        <Input
          value={hubUrlValue}
          onChange={(e) => setHubUrl(e.target.value)}
          placeholder="Hub URL"
          autoComplete="off"
          spellCheck={false}
          className="h-9 font-mono text-[0.75rem]"
        />

        {mode === 'password' ? (
          <>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Username or email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className="h-9"
            />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitLogin()
              }}
              placeholder="Password"
              autoComplete="current-password"
              className="h-9"
            />
            <Button
              className="w-full gap-2"
              disabled={busy || !hubUrlValue.trim() || !identifier.trim() || !password}
              onClick={submitLogin}
            >
              {loginMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
              Log in
            </Button>
            <p className="pt-0.5 text-[0.6875rem] text-muted-foreground">
              <a
                href={registerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
              >
                Create an account
                <ExternalLink className="size-3" />
              </a>
              <span className="px-1.5 text-border">·</span>
              <button
                type="button"
                className="underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setMode('token')
                  setError(null)
                }}
              >
                Use a token
              </button>
            </p>
          </>
        ) : (
          <>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Access token (ern_...)"
              autoComplete="new-password"
              className="h-9 font-mono text-[0.75rem]"
            />
            <Button
              className="w-full gap-2"
              disabled={busy || !hubUrlValue.trim() || !token.trim()}
              onClick={submitToken}
            >
              {connectMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plug className="size-4" />
              )}
              Connect
            </Button>
            <p className="pt-0.5 text-[0.6875rem] text-muted-foreground">
              <button
                type="button"
                className="underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setMode('password')
                  setError(null)
                }}
              >
                Log in with a password instead
              </button>
            </p>
          </>
        )}

        {error && (
          <p className={cn('flex items-start gap-1.5 pt-0.5 text-[0.6875rem] leading-snug text-destructive')}>
            <AlertTriangle className="mt-px size-3 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
