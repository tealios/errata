/**
 * Validators for ids that end up as path segments on disk (story ids, branch
 * ids, fragment ids). Anything accepted here is a single, dot-free segment, so
 * it can never contain `/`, `\`, `..` or an absolute-path prefix.
 *
 * Fragment ids are `{prefix}-{suffix}` but custom/plugin type prefixes may
 * contain `_` or `-`, so the check is a safe-charset one rather than the
 * strict generated-id pattern.
 */

const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const FRAGMENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/

export class InvalidIdError extends Error {
  readonly kind: string
  constructor(kind: string, value: unknown) {
    super(`Invalid ${kind} id: ${JSON.stringify(String(value)).slice(0, 80)}`)
    this.name = 'InvalidIdError'
    this.kind = kind
  }
}

export function isValidStoryId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_SEGMENT_RE.test(id)
}

export function isValidBranchId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_SEGMENT_RE.test(id)
}

export function isValidFragmentId(id: unknown): id is string {
  return typeof id === 'string' && FRAGMENT_ID_RE.test(id)
}

export function assertStoryId(id: unknown): string {
  if (!isValidStoryId(id)) throw new InvalidIdError('story', id)
  return id
}

export function assertBranchId(id: unknown): string {
  if (!isValidBranchId(id)) throw new InvalidIdError('branch', id)
  return id
}

export function assertFragmentId(id: unknown): string {
  if (!isValidFragmentId(id)) throw new InvalidIdError('fragment', id)
  return id
}
