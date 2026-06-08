import { z } from 'zod/v4'

/**
 * Shared "@tealios/erratapack" format contract.
 *
 * Pure Zod v4 + TypeScript. Importable from both client and server: no Node
 * (`fs`, `path`, `Buffer`) and no browser (`window`, `document`) globals. The
 * hub repo keeps its own copy of this file; do not turn it into a workspace.
 *
 * A pack distributes fragments + assets only. The manifest's `capabilities`
 * and `dependencies` exist for forward compatibility, but the MVP install path
 * refuses any pack that declares non-empty capabilities (see
 * `isManifestSafeForMvp`).
 */

/** Global pack id, e.g. `@some-handle/cozy-fantasy-starter`. */
export const GLOBAL_PACK_ID_REGEX = /^@[a-z0-9-]+\/[a-z0-9-]+$/

/** Permissive-but-bounded semver string (major.minor.patch + optional pre/build). */
export const SEMVER_REGEX =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/

/** What a pack carries. A `fragment-pack` is loose fragments; `story` is a full story archive. */
export const ContentKindSchema = z.enum(['fragment-pack', 'story'])
export type ContentKind = z.infer<typeof ContentKindSchema>

/** A declared dependency on another pack by id + version range/string. */
export const PackDependencySchema = z.object({
  id: z.string().regex(GLOBAL_PACK_ID_REGEX),
  version: z.string(),
})
export type PackDependency = z.infer<typeof PackDependencySchema>

/**
 * The manifest is the trust + discovery surface of a pack. Everything a hub or
 * an installing client needs to decide *whether* to install lives here, without
 * reading the payload.
 */
export const ErratapackManifestSchema = z.object({
  /** Format discriminator + version. Always `1` for this revision. */
  errataPack: z.literal(1),
  /** Global id: `@handle/slug`. */
  id: z.string().regex(GLOBAL_PACK_ID_REGEX),
  /** Pack version (semver). */
  version: z.string().regex(SEMVER_REGEX),
  title: z.string().min(1).max(120),
  description: z.string().max(250),
  license: z.string(),
  contentKind: ContentKindSchema,
  /** Errata's own data format version that produced the payload. */
  errataFormatVersion: z.int(),
  /** Fragment types present in the payload (for filtering/discovery). */
  fragmentTypes: z.array(z.string()),
  fragmentCount: z.int(),
  tags: z.array(z.string()),
  nsfw: z.boolean().default(false),
  /**
   * Content rating shown on the pack page. `r18` implies `nsfw`; the boolean
   * `nsfw` above is kept for back-compat. NOTE: the hub's own copy at
   * `app/lib/erratapack/index.ts` must stay in sync (synced by a later task).
   */
  contentRating: z.enum(['general', 'mature', 'r18']).optional(),
  /** Long-form markdown "information" rendered on the pack page. */
  readme: z.string().max(8000).optional(),
  /** Chapter listing for story packs, shown on the pack page. */
  chapters: z
    .array(z.object({ title: z.string().max(200), order: z.int().optional() }))
    .max(2000)
    .optional(),
  /** Asset uri or external url for a cover/preview image. Optional. */
  thumbnail: z.string().optional(),
  /** Reserved for forward compat. MVP install refuses any non-empty value. */
  capabilities: z.array(z.string()).default([]),
  dependencies: z.array(PackDependencySchema).default([]),
  /** Integrity hash of the payload (algorithm-prefixed string, e.g. `sha256:...`). */
  payloadHash: z.string(),
  /** Optional engine constraints. */
  engines: z.object({ errata: z.string().optional() }).optional(),
  /** Publisher handle/display, e.g. `@some-handle`. Optional. */
  publisher: z.string().optional(),
  createdAt: z.iso.datetime(),
})
export type ErratapackManifest = z.infer<typeof ErratapackManifestSchema>

/**
 * Pure-JSON form of a pack (no zip). `payload` is left as `unknown` here so the
 * format contract stays decoupled from the fragment-bundle / story-archive
 * schemas. `assetsInline` maps an asset uri (`asset://<name>`) to base64/dataURL
 * content for the no-zip transport.
 */
export const ErratapackJsonSchema = z.object({
  errataPack: z.literal(1),
  manifest: ErratapackManifestSchema,
  payload: z.unknown(),
  assetsInline: z.record(z.string(), z.string()).optional(),
})
export type ErratapackJson = z.infer<typeof ErratapackJsonSchema>

/** Uri scheme for assets referenced by a pack (e.g. `asset://cover.png`). */
export const ASSET_URI_PREFIX = 'asset://'

/** Hard caps enforced at publish + install time. */
export const PACK_LIMITS = {
  /** Max fragments a single pack may carry. */
  maxFragments: 5000,
  /** Max total payload size (decompressed), bytes. 64 MiB. */
  maxPayloadBytes: 64 * 1024 * 1024,
  /** Max size of any single asset, bytes. 16 MiB. */
  maxAssetBytes: 16 * 1024 * 1024,
} as const

/**
 * Split a global pack id into its `@handle/slug` parts. Returns `null` for any
 * id that does not match `GLOBAL_PACK_ID_REGEX`.
 */
export function parseGlobalPackId(id: string): { handle: string; slug: string } | null {
  if (!GLOBAL_PACK_ID_REGEX.test(id)) return null
  const slashIndex = id.indexOf('/')
  const handle = id.slice(1, slashIndex)
  const slug = id.slice(slashIndex + 1)
  if (!handle || !slug) return null
  return { handle, slug }
}

/**
 * Front-facing URL of a pack's page on the hub site. The page lives at
 * `{hubUrl}/@handle/slug` (the same `@handle/slug` the browser's URL parser
 * extracts from a pasted pack link). Returns null when the hub URL is missing
 * or the id is not a valid global pack id, so callers can hide the link.
 */
export function packPageUrl(hubUrl: string | null | undefined, id: string): string | null {
  const base = (hubUrl ?? '').trim().replace(/\/+$/, '')
  if (!base || !parseGlobalPackId(id)) return null
  return `${base}/${id}`
}

/**
 * MVP trust gate. A pack is safe to install only when it declares no
 * capabilities and carries no scripts. blockConfig / agentBlockConfig and any
 * executable surface are rejected upstream; this guards the manifest side.
 */
export function isManifestSafeForMvp(manifest: ErratapackManifest): boolean {
  if (manifest.capabilities.length > 0) return false
  if (manifest.capabilities.some((cap) => cap.toLowerCase().includes('script'))) return false
  return true
}
