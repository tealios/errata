/**
 * Helpers shared by the publish dialogs (fragment/story packs and agent
 * configs). One copy so slug rules and version bumping can't drift between
 * the two flows.
 */

export type BumpKind = 'patch' | 'minor' | 'major'

/** Derive a pack slug from a title: lowercase, dashes, trimmed. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** Increment a semver core (major.minor.patch). Falls back to 1.0.0 on garbage. */
export function bumpVersion(latest: string | null | undefined, kind: BumpKind): string {
  if (!latest) return '1.0.0'
  const core = latest.split(/[-+]/)[0]
  const parts = core.split('.').map((n) => Number.parseInt(n, 10))
  if (parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return '1.0.0'
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
