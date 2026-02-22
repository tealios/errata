export interface FrozenSection {
  id: string
  text: string
}

export interface ProtectionCheck {
  allowed: boolean
  reason?: string
}

/** Check if a fragment is fully locked. */
export function isFragmentLocked(fragment: { meta: Record<string, unknown> }): boolean {
  return fragment.meta.locked === true
}

/** Parse frozen sections from meta (with safe validation). */
export function getFrozenSections(meta: Record<string, unknown>): FrozenSection[] {
  const raw = meta.frozenSections
  if (!Array.isArray(raw)) return []
  const sections: FrozenSection[] = []
  for (const item of raw) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).id === 'string' &&
      typeof (item as Record<string, unknown>).text === 'string' &&
      (item as Record<string, unknown>).text !== ''
    ) {
      sections.push({ id: (item as Record<string, unknown>).id as string, text: (item as Record<string, unknown>).text as string })
    }
  }
  return sections
}

/**
 * Check if a content update preserves all frozen sections.
 * Returns { allowed: true } or { allowed: false, reason: "..." }.
 */
export function checkContentProtection(
  fragment: { meta: Record<string, unknown>; content: string },
  newContent: string,
): ProtectionCheck {
  const sections = getFrozenSections(fragment.meta)
  for (const section of sections) {
    if (!newContent.includes(section.text)) {
      const truncated = section.text.length > 60
        ? section.text.slice(0, 60) + '...'
        : section.text
      return {
        allowed: false,
        reason: `Frozen section would be altered or removed: "${truncated}"`,
      }
    }
  }
  return { allowed: true }
}

/**
 * Full check for any write operation on a fragment.
 * - If locked, rejects with reason.
 * - If content is changing, validates frozen sections.
 */
export function checkFragmentWrite(
  fragment: { meta: Record<string, unknown>; content: string },
  updates: { content?: string },
): ProtectionCheck {
  if (isFragmentLocked(fragment)) {
    return {
      allowed: false,
      reason: 'Fragment is locked and cannot be modified by AI tools.',
    }
  }
  if (updates.content !== undefined) {
    return checkContentProtection(fragment, updates.content)
  }
  return { allowed: true }
}
