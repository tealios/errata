import { zipSync, unzipSync, strFromU8 } from 'fflate'
import {
  ErratapackManifestSchema,
  ErratapackJsonSchema,
  type ErratapackManifest,
} from '@/lib/erratanet/pack-schema'
import type { FragmentBundleData, FragmentExportEntry } from '@/lib/fragment-clipboard'
import { createFragment, getFragment, getStory, updateStory } from '../fragments/storage'
import { generateFragmentId } from '@/lib/fragment-ids'
import { isValidFragmentId, resolveInside, UnsafePathError } from '../safe-id'
import { registry } from '../fragments/registry'
import { remapFragment, type IdMap } from '../fragments/remap'
import { importStoryFromZip } from '../story-archive'
import type { Fragment, StoryMeta } from '../fragments/schema'

/**
 * Server-side install path for the shared "@tealios/erratapack" format.
 *
 * Three pieces:
 *  - {@link unwrapPack} reads a pack (zip bytes or pure-JSON) into a validated
 *    manifest + payload, re-inlining `asset://` references as data URLs.
 *  - {@link installFragmentBundle} is the ref-aware batch importer for a
 *    fragment-pack payload. It pre-allocates ids so cross-fragment refs survive.
 *  - {@link installStoryPack} feeds a story payload into the existing
 *    story-archive importer and stamps provenance on the new story.
 *
 * Trust: MVP packs carry fragments + assets only. A non-empty
 * `manifest.capabilities` is refused here (defence in depth alongside the
 * manifest-level `isManifestSafeForMvp`). blockConfig / agentBlockConfigs that
 * may ride along in a bundle are ignored, never applied.
 */

export interface PackProvenance {
  /** Global pack id, e.g. `@handle/slug`. */
  pack: string
  /** Pack version (semver). */
  version: string
}

export type UnwrappedPack =
  | { manifest: ErratapackManifest; contentKind: 'fragment-pack'; bundle: FragmentBundleData }
  | { manifest: ErratapackManifest; contentKind: 'story'; storyFiles: Record<string, Uint8Array> }

const ASSET_URI_RE = /^asset:\/\/(.+)$/
const PAYLOAD_BUNDLE_PATH = 'payload/bundle.json'
const PAYLOAD_STORY_PREFIX = 'payload/story/'

/** Map a file extension to an image mime type for data-url re-inlining. */
function mimeForExt(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

/** Base64-encode raw bytes without relying on a Buffer global being typed. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Resolve a single `asset://<hash>` content reference to an inline data URL. */
function resolveAssetContent(
  content: string,
  resolve: (assetKey: string) => { bytes: Uint8Array; mime: string } | undefined,
): string {
  const match = ASSET_URI_RE.exec(content)
  if (!match) return content
  const found = resolve(match[1])
  if (!found) return content
  return `data:${found.mime};base64,${bytesToBase64(found.bytes)}`
}

/** Re-inline every attachment whose content is an `asset://` uri. */
function reinlineBundleAssets(
  bundle: FragmentBundleData,
  resolve: (assetKey: string) => { bytes: Uint8Array; mime: string } | undefined,
): FragmentBundleData {
  const fragments: FragmentExportEntry[] = bundle.fragments.map((entry) => {
    if (!entry.attachments || entry.attachments.length === 0) return entry
    return {
      ...entry,
      attachments: entry.attachments.map((att) => ({
        ...att,
        content: resolveAssetContent(att.content, resolve),
      })),
    }
  })
  return { ...bundle, fragments }
}

/**
 * Read and validate a pack from zip bytes (or a pure-JSON erratapack).
 *
 * Refuses any pack whose manifest declares non-empty `capabilities`. For a
 * fragment-pack, attachment contents stored as `asset://<hash>` are re-inlined
 * as data URLs from the zip's `assets/` directory (or from `assetsInline` for
 * the pure-JSON form). For a story pack, the `payload/story/` subtree is
 * returned as a path -> bytes map for the story-archive importer.
 */
export function unwrapPack(zipBytes: Uint8Array): UnwrappedPack {
  // Detect the pure-JSON form first: it parses as an ErratapackJson object.
  const jsonForm = tryParseJsonPack(zipBytes)
  if (jsonForm) return jsonForm

  const extracted = unzipSync(zipBytes)
  const manifestBytes = extracted['manifest.json']
  if (!manifestBytes) {
    throw new Error('Invalid pack: missing manifest.json')
  }
  const manifest = ErratapackManifestSchema.parse(JSON.parse(strFromU8(manifestBytes)))

  assertSafeManifest(manifest)

  if (manifest.contentKind === 'fragment-pack') {
    const bundleBytes = extracted[PAYLOAD_BUNDLE_PATH]
    if (!bundleBytes) {
      throw new Error(`Invalid fragment-pack: missing ${PAYLOAD_BUNDLE_PATH}`)
    }
    const rawBundle = JSON.parse(strFromU8(bundleBytes)) as FragmentBundleData
    const bundle = reinlineBundleAssets(rawBundle, (assetKey) => findAsset(extracted, assetKey))
    return { manifest, contentKind: 'fragment-pack', bundle }
  }

  // contentKind === 'story': collect the payload/story/ subtree (re-rooted).
  const storyFiles: Record<string, Uint8Array> = {}
  for (const [path, bytes] of Object.entries(extracted)) {
    if (!path.startsWith(PAYLOAD_STORY_PREFIX)) continue
    const rel = path.slice(PAYLOAD_STORY_PREFIX.length)
    if (rel === '' || rel.endsWith('/')) continue // directory entry
    try {
      resolveInside('/pack-root', rel)
    } catch (err) {
      if (err instanceof UnsafePathError) throw new Error(`Invalid story pack: ${err.message}`)
      throw err
    }
    storyFiles[rel] = bytes
  }
  if (Object.keys(storyFiles).length === 0) {
    throw new Error(`Invalid story pack: missing ${PAYLOAD_STORY_PREFIX} subtree`)
  }
  return { manifest, contentKind: 'story', storyFiles }
}

/**
 * Find the raw bytes for an `asset://<hash>` reference. The hash may or may not
 * carry an extension, so we match `assets/<hash>` exactly or `assets/<hash>.*`.
 */
function findAsset(
  extracted: Record<string, Uint8Array>,
  assetKey: string,
): { bytes: Uint8Array; mime: string } | undefined {
  // The stored file keeps the original extension (assets/<hash>.<ext>), so the
  // mime comes from the matched path, not the bare hash in the asset:// uri.
  const exact = extracted[`assets/${assetKey}`]
  if (exact) return { bytes: exact, mime: mimeForExt(assetKey) }
  const prefix = `assets/${assetKey}.`
  for (const [path, bytes] of Object.entries(extracted)) {
    if (path.startsWith(prefix)) return { bytes, mime: mimeForExt(path) }
  }
  return undefined
}

/** Attempt to read the pure-JSON erratapack form. Returns null if not JSON. */
function tryParseJsonPack(zipBytes: Uint8Array): UnwrappedPack | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(zipBytes))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || !('errataPack' in parsed)) return null

  const json = ErratapackJsonSchema.parse(parsed)
  const manifest = json.manifest
  assertSafeManifest(manifest)

  const inline = json.assetsInline ?? {}

  if (manifest.contentKind === 'fragment-pack') {
    const rawBundle = json.payload as FragmentBundleData
    // Re-inline asset:// references from assetsInline string values (base64 or data URL).
    const bundle = inlineBundleFromStrings(rawBundle, inline)
    return { manifest, contentKind: 'fragment-pack', bundle }
  }

  throw new Error('Story packs must be delivered as a zip, not pure JSON')
}

/** Re-inline attachment asset:// references from a string asset map. */
function inlineBundleFromStrings(
  bundle: FragmentBundleData,
  inline: Record<string, string>,
): FragmentBundleData {
  const fragments: FragmentExportEntry[] = bundle.fragments.map((entry) => {
    if (!entry.attachments || entry.attachments.length === 0) return entry
    return {
      ...entry,
      attachments: entry.attachments.map((att) => {
        const match = ASSET_URI_RE.exec(att.content)
        if (!match) return att
        // assetsInline is keyed by the full asset:// uri; fall back to the bare
        // hash for older/loose maps.
        const value = inline[match[0]] ?? inline[match[1]]
        if (typeof value !== 'string') return att
        // A data URL is ready to use as-is; bare base64 becomes a generic data URL.
        const content = value.startsWith('data:')
          ? value
          : `data:${mimeForExt(match[1])};base64,${value}`
        return { ...att, content }
      }),
    }
  })
  return { ...bundle, fragments }
}

/**
 * Trust gate for the fragment/story install path. Agent-config packs are valid
 * but handled by a dedicated pipeline (`unwrapAgentConfigPack` + the
 * agent-config routes) — name that instead of a misleading capability refusal.
 * Anything else declaring capabilities is refused (defence in depth alongside
 * the manifest-level `isManifestSafeForMvp`).
 */
function assertSafeManifest(manifest: ErratapackManifest): void {
  if (manifest.contentKind === 'agent-config') {
    throw new Error(
      'This is an agent configuration pack; use the agent-config import flow, not install.',
    )
  }
  if (manifest.capabilities.length > 0) {
    throw new Error('Refusing pack: declares capabilities (unsupported in MVP)')
  }
}

interface VisualRef {
  fragmentId: string
  kind: 'image' | 'icon'
  boundary?: { x: number; y: number; width: number; height: number }
}

/**
 * Ref-aware batch importer for a fragment bundle. Unlike the per-entry client
 * importer, this pre-allocates every fragment id up front so that cross-fragment
 * refs, meta.previousFragmentId, meta.variationOf, and visualRefs survive the
 * import instead of dangling.
 *
 * Steps:
 *  (a) Pre-allocate an idMap: keep `entry.id` when it is free in the story,
 *      otherwise mint a fresh id of the same type.
 *  (b) Create attachment image/icon fragments first and build visualRefs.
 *  (c) Remap each entry's refs[] and meta id references through the idMap.
 *  (d) Stamp meta.erratanet provenance.
 *  (e) Create each fragment with its pre-assigned id.
 *
 * Server-side only: uses createFragment / getFragment directly, never the
 * client api. blockConfig / agentBlockConfigs on the bundle are ignored.
 */
export async function installFragmentBundle(
  dataDir: string,
  storyId: string,
  bundle: FragmentBundleData,
  provenance: PackProvenance,
): Promise<Fragment[]> {
  const now = new Date().toISOString()

  // (a) Pre-allocate ids: keep entry.id when free, else mint a new one.
  const idMap = new Map<string, string>()
  const taken = new Set<string>()
  const entryNewIds: Array<string> = []

  for (const entry of bundle.fragments) {
    let newId: string
    if (isValidFragmentId(entry.id) && !taken.has(entry.id) && !(await getFragment(dataDir, storyId, entry.id))) {
      newId = entry.id
    } else {
      newId = generateFragmentId(entry.type)
      while (taken.has(newId) || (await getFragment(dataDir, storyId, newId))) {
        newId = generateFragmentId(entry.type)
      }
    }
    taken.add(newId)
    entryNewIds.push(newId)
    // First entry wins when a bundle repeats an id; later duplicates get fresh ids
    // but must not hijack refs that point at the original.
    if (entry.id && !idMap.has(entry.id)) idMap.set(entry.id, newId)
  }

  const created: Fragment[] = []

  for (let i = 0; i < bundle.fragments.length; i++) {
    const entry = bundle.fragments[i]
    const newId = entryNewIds[i]

    // (b) Create attachment image/icon fragments first; collect visualRefs.
    const visualRefs: VisualRef[] = []
    if (entry.attachments && entry.attachments.length > 0) {
      for (const att of entry.attachments) {
        let mediaId = generateFragmentId(att.kind)
        while (taken.has(mediaId) || (await getFragment(dataDir, storyId, mediaId))) {
          mediaId = generateFragmentId(att.kind)
        }
        taken.add(mediaId)
        const mediaFragment = buildFragment({
          id: mediaId,
          type: att.kind,
          name: att.name,
          description: att.description ?? '',
          content: att.content,
          now,
          provenance,
          sourceLocalId: undefined,
        })
        await createFragment(dataDir, storyId, mediaFragment, { overwrite: true })
        created.push(mediaFragment)
        visualRefs.push({
          fragmentId: mediaId,
          kind: att.kind,
          ...(att.boundary ? { boundary: att.boundary } : {}),
        })
      }
    }

    // (c) Remap refs[] and meta id references through the idMap. Build a
    // temporary Fragment so we can reuse the shared remap helper, then merge.
    const baseMeta: Record<string, unknown> = { ...(entry.meta ?? {}) }
    const originalRefs = Array.isArray(baseMeta.visualRefs) ? (baseMeta.visualRefs as VisualRef[]) : []
    if (originalRefs.length > 0 || visualRefs.length > 0) {
      // Keep visual refs to fragments bundled here (remapped below); drop the
      // dangling ones (their image arrives via attachments instead); then add
      // the attachment-derived refs.
      baseMeta.visualRefs = [...originalRefs.filter((ref) => idMap.has(ref.fragmentId)), ...visualRefs]
    }

    const remapped = remapFragment(
      {
        id: entry.id ?? newId,
        type: entry.type,
        name: entry.name,
        description: entry.description ?? '',
        content: entry.content,
        tags: entry.tags ?? [],
        refs: entry.refs ?? [],
        sticky: false,
        placement: 'user',
        createdAt: now,
        updatedAt: now,
        order: 0,
        meta: baseMeta,
        archived: false,
        version: 1,
        versions: [],
      },
      idMap as IdMap,
    )

    // The visualRefs we just minted already point at the new media ids; the
    // remap helper would leave them unchanged (no idMap entry), which is correct.

    // (d) Stamp provenance.
    const meta: Record<string, unknown> = {
      ...remapped.meta,
      erratanet: {
        pack: provenance.pack,
        version: provenance.version,
        sourceLocalId: entry.id,
      },
    }

    // (e) Create with the pre-assigned id and original placement/sticky/order.
    const fragment: Fragment = {
      ...remapped,
      id: newId,
      sticky: entry.sticky ?? registry.getType(entry.type)?.stickyByDefault ?? false,
      placement: entry.placement ?? 'user',
      order: entry.order ?? 0,
      meta,
    }
    await createFragment(dataDir, storyId, fragment, { overwrite: true })
    created.push(fragment)
  }

  return created
}

interface BuildFragmentArgs {
  id: string
  type: string
  name: string
  description: string
  content: string
  now: string
  provenance: PackProvenance
  sourceLocalId: string | undefined
}

function buildFragment(args: BuildFragmentArgs): Fragment {
  return {
    id: args.id,
    type: args.type,
    name: args.name,
    description: args.description,
    content: args.content,
    tags: [],
    refs: [],
    sticky: registry.getType(args.type)?.stickyByDefault ?? false,
    placement: 'user',
    createdAt: args.now,
    updatedAt: args.now,
    order: 0,
    meta: {
      erratanet: {
        pack: args.provenance.pack,
        version: args.provenance.version,
        ...(args.sourceLocalId ? { sourceLocalId: args.sourceLocalId } : {}),
      },
    },
    archived: false,
    version: 1,
    versions: [],
  }
}

/**
 * Install a story pack: feed the (already-unzipped) `payload/story/` subtree into
 * the existing story-archive importer, then stamp `settings.erratanet`
 * provenance on the new story. Returns the created StoryMeta.
 *
 * The story subtree is re-zipped and handed to {@link importStoryFromZip} so all
 * of its battle-tested id/ref/prose-chain/associations remapping is reused with
 * zero new logic.
 */
export async function installStoryPack(
  dataDir: string,
  storyFiles: Record<string, Uint8Array>,
  provenance: PackProvenance,
): Promise<StoryMeta> {
  const zipBytes = zipSync(storyFiles)
  const meta = await importStoryFromZip(dataDir, zipBytes)

  const story = await getStory(dataDir, meta.id)
  if (!story) return meta

  const stamped: StoryMeta = {
    ...story,
    settings: {
      ...story.settings,
      erratanet: {
        pack: provenance.pack,
        version: provenance.version,
      },
    },
    updatedAt: new Date().toISOString(),
  }
  await updateStory(dataDir, stamped)
  return stamped
}
