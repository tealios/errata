import type { Fragment } from '@/lib/api'

function sanitize(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function componentId(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => sanitize(p))
    .join('-')
}

export function fragmentDomPrefix(fragment: Pick<Fragment, 'id' | 'type'>): string {
  const raw = fragment.id.toLowerCase()
  if (raw.includes('-')) {
    return sanitize(raw)
  }

  const typePrefix: Record<string, string> = {
    prose: 'pr',
    character: 'ch',
    guideline: 'gl',
    knowledge: 'kn',
    image: 'im',
    icon: 'ic',
  }
  return componentId(typePrefix[fragment.type] ?? fragment.type.slice(0, 2), raw)
}

export function fragmentComponentId(fragment: Pick<Fragment, 'id' | 'type'>, suffix: string): string {
  return componentId(fragmentDomPrefix(fragment), suffix)
}
