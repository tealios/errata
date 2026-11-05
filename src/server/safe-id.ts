/**
 * Validators for ids that end up as path segments on disk (story ids, branch
 * ids, fragment ids). Anything accepted here is a single, dot-free segment, so
 * it can never contain `/`, `\`, `..` or an absolute-path prefix.
 *
 * Fragment ids are `{prefix}-{suffix}` but custom/plugin type prefixes may
 * contain `_` or `-`, so the check is a safe-charset one rather than the
 * strict generated-id pattern.
 */

import { isAbsolute, relative, resolve } from 'node:path'

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

export class UnsafePathError extends Error {
  constructor(entry: string) {
    super(`Unsafe path in archive: ${JSON.stringify(entry).slice(0, 120)}`)
    this.name = 'UnsafePathError'
  }
}

/**
 * Resolve an untrusted relative path (e.g. an archive entry) under `base`.
 * Rejects absolute paths, drive letters, backslashes, NUL bytes, `..` segments
 * and anything whose resolved target escapes `base`.
 */
export function resolveInside(base: string, rel: string): string {
  if (
    typeof rel !== 'string' ||
    rel.length === 0 ||
    rel.includes(String.fromCharCode(0)) ||
    rel.includes(String.fromCharCode(92)) ||
    rel.startsWith('/') ||
    /^[A-Za-z]:/.test(rel) ||
    isAbsolute(rel) ||
    rel.split('/').some((seg) => seg === '..')
  ) {
    throw new UnsafePathError(rel)
  }
  const target = resolve(base, rel)
  const rel2 = relative(resolve(base), target)
  if (rel2 === '' || rel2.startsWith('..') || isAbsolute(rel2)) throw new UnsafePathError(rel)
  return target
}
