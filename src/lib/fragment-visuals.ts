import type { Fragment } from '@/lib/api'

export interface BoundaryBox {
  x: number
  y: number
  width: number
  height: number
}

export interface VisualRef {
  fragmentId: string
  kind: 'image' | 'icon'
  boundary?: BoundaryBox
}

interface ImagePayload {
  url?: string
}

export function parseVisualRefs(meta: Record<string, unknown> | undefined): VisualRef[] {
  const raw = meta?.visualRefs
  if (!Array.isArray(raw)) return []

  const refs: VisualRef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const fragmentId = typeof obj.fragmentId === 'string' ? obj.fragmentId : null
    const kind = obj.kind === 'icon' ? 'icon' : obj.kind === 'image' ? 'image' : null
    if (!fragmentId || !kind) continue

    let boundary: BoundaryBox | undefined
    const rawBoundary = obj.boundary
    if (rawBoundary && typeof rawBoundary === 'object') {
      const b = rawBoundary as Record<string, unknown>
      const x = typeof b.x === 'number' ? b.x : 0
      const y = typeof b.y === 'number' ? b.y : 0
      const width = typeof b.width === 'number' ? b.width : 1
      const height = typeof b.height === 'number' ? b.height : 1
      if (width > 0 && height > 0) {
        boundary = { x, y, width, height }
      }
    }

    refs.push({ fragmentId, kind, boundary })
  }

  return refs
}

export function readImageUrl(fragment: Fragment): string | null {
  const raw = fragment.content.trim()
  if (!raw) return null

  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:image/')) {
    return raw
  }

  try {
    const parsed = JSON.parse(raw) as ImagePayload
    if (typeof parsed.url === 'string' && parsed.url.trim()) {
      return parsed.url.trim()
    }
  } catch {
    // Non-JSON content; no URL to extract.
  }

  return null
}

export function gradientForId(id: string): string {
  const gradients = [
    'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
    'linear-gradient(135deg, #22c55e 0%, #14b8a6 100%)',
    'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
    'linear-gradient(135deg, #eab308 0%, #f97316 100%)',
    'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)',
    'linear-gradient(135deg, #f43f5e 0%, #fb7185 100%)',
  ]

  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % gradients.length
  return gradients[index]
}

export function resolveFragmentVisual(fragment: Fragment, mediaById: Map<string, Fragment>): {
  imageUrl: string | null
  boundary?: BoundaryBox
} {
  if (fragment.type === 'image' || fragment.type === 'icon') {
    return { imageUrl: readImageUrl(fragment) }
  }

  const refs = parseVisualRefs(fragment.meta)
  const selected = refs.find((r) => r.kind === 'icon') ?? refs.find((r) => r.kind === 'image')
  if (!selected) return { imageUrl: null }

  const media = mediaById.get(selected.fragmentId)
  if (!media) return { imageUrl: null }

  return {
    imageUrl: readImageUrl(media),
    boundary: selected.boundary,
  }
}
