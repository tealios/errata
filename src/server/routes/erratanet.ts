import { Elysia, t } from 'elysia'
import { getErratanetConfig, updateErratanetConfig } from '../config/storage'
import {
  getAccount as hubGetAccount,
  search as hubSearch,
  getPack as hubGetPack,
  downloadPack as hubDownloadPack,
  publishVersion as hubPublishVersion,
  login as hubLogin,
} from '../erratanet/hub-client'
import { buildFragmentPack, buildStoryPack, type PackManifestInput } from '../erratanet/pack-build'
import { unwrapPack, installFragmentBundle, installStoryPack } from '../erratanet/pack-install'
import { getStory, listFragments, updateStory } from '../fragments/storage'
import type { ErratanetConfig } from '../config/schema'

/** Normalize an unknown error into a message string. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Could not reach the hub.'
}

/** Pull the latest version from a hub pack response (distTags, then manifest, then versions). */
function packLatestVersion(pack: Record<string, unknown>): string | undefined {
  const distTags = pack.distTags as { latest?: unknown } | undefined
  if (typeof distTags?.latest === 'string') return distTags.latest
  const manifest = pack.manifest as { version?: unknown } | undefined
  if (typeof manifest?.version === 'string') return manifest.version
  const versions = pack.versions
  if (Array.isArray(versions) && versions.length > 0) {
    const first = versions[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object') {
      const v = (first as { version?: unknown }).version
      if (typeof v === 'string') return v
    }
  }
  return undefined
}

/**
 * The caller-supplied half of a pack manifest, shared by the publish endpoint.
 * The build derives everything else (contentKind, hashes, counts, createdAt).
 */
const manifestBody = t.Object({
  id: t.String(),
  version: t.String(),
  title: t.String(),
  description: t.String(),
  license: t.String(),
  tags: t.Optional(t.Array(t.String())),
  nsfw: t.Optional(t.Boolean()),
  readme: t.Optional(t.String()),
  contentRating: t.Optional(t.String()),
  chapters: t.Optional(
    t.Array(t.Object({ title: t.String(), order: t.Optional(t.Number()) })),
  ),
  thumbnail: t.Optional(t.String()),
  publisher: t.Optional(t.String()),
})

/** Provenance stamped on a story or its fragments by the install path. */
interface InstalledPack {
  pack: string
  version: string
}

/** Redacted view of the erratanet config. The token is never returned raw. */
function redactConfig(config: ErratanetConfig) {
  return {
    hubUrl: config.hubUrl,
    token: config.token ? '••••' : '',
    handle: config.handle,
    enabled: config.enabled,
    introSeen: config.introSeen,
  }
}

export function erratanetRoutes(dataDir: string) {
  return new Elysia({ detail: { tags: ['Erratanet'] } })
    // Current hub connection config, with the token redacted.
    .get('/erratanet/config', async () => redactConfig(await getErratanetConfig(dataDir)), {
      detail: { summary: 'Current erratanet hub config (token redacted)' },
    })

    // Update the hub URL and/or token. An empty token signs the account out and
    // clears the resolved handle. A non-empty token is stored as-is; the handle
    // is resolved on the next getAccount call.
    .post('/erratanet/config', async ({ body }) => {
      const patch: Partial<ErratanetConfig> = {}
      if (body.hubUrl !== undefined) patch.hubUrl = body.hubUrl.trim()
      if (body.token !== undefined) {
        patch.token = body.token
        // Signing out clears the cached handle.
        if (!body.token) patch.handle = undefined
      }
      if (body.enabled !== undefined) patch.enabled = body.enabled
      if (body.introSeen !== undefined) patch.introSeen = body.introSeen
      const next = await updateErratanetConfig(dataDir, patch)
      return redactConfig(next)
    }, {
      body: t.Object({
        hubUrl: t.Optional(t.String()),
        token: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
        introSeen: t.Optional(t.Boolean()),
      }),
    })

    // Log in with username/email + password. Exchanges the credentials for a
    // fresh API token via the hub, stores the hub URL + token + handle, and
    // returns the connected account. The password never touches local storage.
    .post('/erratanet/login', async ({ body, set }) => {
      const hubUrl = body.hubUrl.trim()
      if (!hubUrl) {
        set.status = 422
        return { connected: false, error: 'Enter a hub URL.' }
      }
      if (!body.identifier.trim() || !body.password) {
        set.status = 422
        return { connected: false, error: 'Enter your username and password.', hubUrl }
      }
      try {
        const result = await hubLogin(hubUrl, body.identifier.trim(), body.password)
        await updateErratanetConfig(dataDir, {
          hubUrl,
          token: result.token,
          handle: result.handle,
        })
        return { connected: true, handle: result.handle, displayName: result.displayName, hubUrl }
      } catch (e) {
        set.status = 401
        return { connected: false, error: errorMessage(e), hubUrl }
      }
    }, {
      detail: { summary: 'Log in with credentials and store a hub token' },
      body: t.Object({
        hubUrl: t.String(),
        identifier: t.String(),
        password: t.String(),
      }),
    })

    // Resolve the account for the configured token. Caches the handle back into
    // config on success. Returns connected:false (never throws) when the hub is
    // unreachable or the token is missing/invalid, so the UI can show the error.
    .get('/erratanet/account', async () => {
      const config = await getErratanetConfig(dataDir)
      if (!config.hubUrl.trim() || !config.token) {
        return { connected: false, hubUrl: config.hubUrl || undefined }
      }
      try {
        const account = await hubGetAccount(dataDir)
        const handle = typeof account.handle === 'string' ? account.handle : undefined
        if (handle && handle !== config.handle) {
          await updateErratanetConfig(dataDir, { handle })
        }
        const displayName = typeof account.displayName === 'string' ? account.displayName : undefined
        return { connected: true, handle, displayName, hubUrl: config.hubUrl }
      } catch (e) {
        return {
          connected: false,
          hubUrl: config.hubUrl,
          error: e instanceof Error ? e.message : 'Could not reach the hub.',
        }
      }
    }, {
      detail: { summary: 'Resolve the account for the configured hub token' },
    })

    // Full-text search across published packs. Public (no token required).
    .get('/erratanet/search', async ({ query, set }) => {
      try {
        return await hubSearch(dataDir, query.q ?? '')
      } catch (e) {
        set.status = 502
        return { error: errorMessage(e) }
      }
    }, {
      detail: { summary: 'Search published packs' },
      query: t.Object({ q: t.Optional(t.String()) }),
    })

    // Fetch a single pack's metadata. `id` may arrive url-encoded (@handle/slug).
    // The hub response keeps the latest version in distTags/manifest/versions,
    // not a top-level field; normalize a `version` so the client (and the
    // publish dialog's version bump) can read the current latest directly.
    .get('/erratanet/packs/:id', async ({ params, set }) => {
      try {
        const pack = await hubGetPack(dataDir, decodeURIComponent(params.id))
        const version = packLatestVersion(pack as Record<string, unknown>)
        return version ? { ...pack, version } : pack
      } catch (e) {
        set.status = 502
        return { error: errorMessage(e) }
      }
    }, { detail: { summary: 'Get a pack by id (@handle/slug, url-encoded)' } })

    // Build a pack from a fragment bundle or a story, then publish a new version.
    // MVP packs carry fragments + assets only; the builders refuse blockConfig /
    // agentBlockConfigs and force empty capabilities.
    .post('/erratanet/publish', async ({ body, set }) => {
      if (!body.bundleJson && !body.storyId) {
        set.status = 422
        return { error: 'Provide either bundleJson or storyId to publish.' }
      }

      const manifestInput: PackManifestInput = {
        id: body.manifest.id,
        version: body.manifest.version,
        title: body.manifest.title,
        description: body.manifest.description,
        license: body.manifest.license,
        ...(body.manifest.tags ? { tags: body.manifest.tags } : {}),
        ...(body.manifest.nsfw !== undefined ? { nsfw: body.manifest.nsfw } : {}),
        ...(body.manifest.readme ? { readme: body.manifest.readme } : {}),
        ...(body.manifest.contentRating ? { contentRating: body.manifest.contentRating } : {}),
        ...(body.manifest.chapters ? { chapters: body.manifest.chapters } : {}),
        ...(body.manifest.thumbnail ? { thumbnail: body.manifest.thumbnail } : {}),
        ...(body.manifest.publisher ? { publisher: body.manifest.publisher } : {}),
      }

      try {
        const built = body.bundleJson
          ? buildFragmentPack({ bundleJson: body.bundleJson, manifestInput })
          : await buildStoryPack(dataDir, body.storyId!, manifestInput)
        const result = await hubPublishVersion(dataDir, built.manifest.id, built.manifest, built.zip, {
          unlisted: body.unlisted ?? false,
        })

        // Stamp the local story so it knows where it is published; this is what
        // the sidebar reads to offer "sync" (publish an update) later.
        let publishedAs: { pack: string; version: string } | undefined
        if (body.storyId && built.manifest.contentKind === 'story') {
          publishedAs = { pack: result.id, version: result.version }
          await stampStoryPublished(dataDir, body.storyId, publishedAs)
        } else if (body.storyId && built.manifest.contentKind === 'fragment-pack') {
          // Remember the fragment pack (and its fragments) so the sidebar can
          // list it and re-sync it later.
          await stampStoryFragmentPack(dataDir, body.storyId, {
            pack: result.id,
            version: result.version,
            fragmentIds: body.fragmentIds ?? [],
          })
        }

        return { id: result.id, version: result.version, publishedAs }
      } catch (e) {
        set.status = 422
        return { error: errorMessage(e) }
      }
    }, {
      detail: { summary: 'Publish a new pack version from a fragment bundle or a story' },
      body: t.Object({
        bundleJson: t.Optional(t.String()),
        storyId: t.Optional(t.String()),
        fragmentIds: t.Optional(t.Array(t.String())),
        unlisted: t.Optional(t.Boolean()),
        manifest: manifestBody,
      }),
    })

    // Download a pack and install it. A fragment pack merges into targetStoryId;
    // a story pack always lands as a brand-new story.
    .post('/erratanet/install', async ({ body, set }) => {
      try {
        const archive = await hubDownloadPack(dataDir, body.id, body.version)
        const unwrapped = unwrapPack(new Uint8Array(archive))
        const provenance: InstalledPack = {
          pack: unwrapped.manifest.id,
          version: unwrapped.manifest.version,
        }

        if (unwrapped.contentKind === 'fragment-pack') {
          if (!body.targetStoryId) {
            set.status = 422
            return { error: 'A target story is required to install a fragment pack.' }
          }
          const story = await getStory(dataDir, body.targetStoryId)
          if (!story) {
            set.status = 404
            return { error: 'Target story not found.' }
          }
          const created = await installFragmentBundle(dataDir, body.targetStoryId, unwrapped.bundle, provenance)
          return { createdFragmentIds: created.map((f) => f.id) }
        }

        const meta = await installStoryPack(dataDir, unwrapped.storyFiles, provenance)
        return { newStoryId: meta.id }
      } catch (e) {
        set.status = 422
        return { error: errorMessage(e) }
      }
    }, {
      detail: { summary: 'Download and install a pack into a story or as a new story' },
      body: t.Object({
        id: t.String(),
        version: t.Optional(t.String()),
        targetStoryId: t.Optional(t.String()),
        asNewStory: t.Optional(t.Boolean()),
      }),
    })

    // For every pack installed into a story, ask the hub for its latest version
    // and flag the ones with an update available.
    .get('/erratanet/stories/:storyId/updates', async ({ params, set }) => {
      const story = await getStory(dataDir, params.storyId)
      if (!story) {
        set.status = 404
        return { error: 'Story not found' }
      }

      const installed = await collectInstalledPacks(dataDir, params.storyId, story)
      if (installed.length === 0) return []

      return Promise.all(installed.map(async (entry) => {
        try {
          const pack = await hubGetPack(dataDir, entry.pack)
          const latest = typeof pack.latestVersion === 'string' ? pack.latestVersion : entry.version
          return { pack, installed: entry.version, latest, hasUpdate: latest !== entry.version }
        } catch (e) {
          return {
            pack: { id: entry.pack },
            installed: entry.version,
            latest: entry.version,
            hasUpdate: false,
            error: errorMessage(e),
          }
        }
      }))
    }, { detail: { summary: 'Check installed packs for available updates' } })
}

/** Record where a story is published, preserving any install provenance. */
async function stampStoryPublished(
  dataDir: string,
  storyId: string,
  publishedAs: { pack: string; version: string },
): Promise<void> {
  const story = await getStory(dataDir, storyId)
  if (!story) return
  const existing = (story.settings.erratanet ?? {}) as Record<string, unknown>
  await updateStory(dataDir, {
    ...story,
    settings: { ...story.settings, erratanet: { ...existing, publishedAs } },
  })
}

type StoryFragmentPack = { pack: string; version: string; fragmentIds: string[] }

/** Record a fragment pack published from a story, deduped by pack id (position kept). */
async function stampStoryFragmentPack(
  dataDir: string,
  storyId: string,
  entry: StoryFragmentPack,
): Promise<void> {
  const story = await getStory(dataDir, storyId)
  if (!story) return
  const existing = (story.settings.erratanet ?? {}) as Record<string, unknown>
  const prior = Array.isArray(existing.fragmentPacks)
    ? (existing.fragmentPacks as StoryFragmentPack[])
    : []
  const idx = prior.findIndex((p) => p.pack === entry.pack)
  const fragmentPacks = idx >= 0 ? prior.map((p, i) => (i === idx ? entry : p)) : [...prior, entry]
  await updateStory(dataDir, {
    ...story,
    settings: { ...story.settings, erratanet: { ...existing, fragmentPacks } },
  })
}

/**
 * Gather every distinct pack installed into a story, deduped by id (last stamp
 * wins). Provenance lives in two places: a story installed whole stamps
 * `settings.erratanet`; fragment packs stamp `meta.erratanet` per fragment.
 */
async function collectInstalledPacks(
  dataDir: string,
  storyId: string,
  story: Awaited<ReturnType<typeof getStory>>,
): Promise<InstalledPack[]> {
  const byId = new Map<string, string>()

  const storyStamp = readErratanetStamp((story?.settings as Record<string, unknown> | undefined)?.erratanet)
  if (storyStamp) byId.set(storyStamp.pack, storyStamp.version)

  const fragments = await listFragments(dataDir, storyId, undefined, { includeArchived: true })
  for (const fragment of fragments) {
    const stamp = readErratanetStamp(fragment.meta?.erratanet)
    if (stamp) byId.set(stamp.pack, stamp.version)
  }

  return Array.from(byId, ([pack, version]) => ({ pack, version }))
}

/** Read a `{ pack, version }` provenance stamp from an unknown meta value. */
function readErratanetStamp(value: unknown): InstalledPack | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (typeof obj.pack !== 'string' || typeof obj.version !== 'string') return null
  return { pack: obj.pack, version: obj.version }
}
