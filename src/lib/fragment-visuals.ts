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

// ── Guilloche pattern system ─────────────────────────────

type GuillocheMode = 'light' | 'dark'

interface GuillocheColorSet {
  bg: string
  colors: string[]
  accent: string
}

const GUILLOCHE_PALETTES: Record<GuillocheMode, GuillocheColorSet[]> = {
  dark: [
    // Dusty rose
    { bg: '#1c181d', colors: ['#c9a0ae', '#b8909e', '#d4b0bc', '#a88494'], accent: '#e0c8d2' },
    // Sea glass
    { bg: '#161d1e', colors: ['#88b5ad', '#78a8a0', '#98c2ba', '#6a9a92'], accent: '#b5d5ce' },
    // Aged amber
    { bg: '#1c1a16', colors: ['#c4a47a', '#b49770', '#d0b18a', '#a88e64'], accent: '#dcc8a5' },
    // Twilight lavender
    { bg: '#1a191f', colors: ['#a496b8', '#978aac', '#b0a2c4', '#887ca0'], accent: '#c8bdd8' },
    // Sage botanical
    { bg: '#181d18', colors: ['#88a888', '#7c9c7c', '#94b494', '#708e70'], accent: '#aec8ae' },
    // Porcelain blue
    { bg: '#181a1e', colors: ['#88a2b8', '#7c96ac', '#94aec4', '#6e8aa0'], accent: '#aec2d5' },
    // Soft coral
    { bg: '#1d1a18', colors: ['#c0948a', '#b4887e', '#cca096', '#a87c72'], accent: '#d8b5ae' },
    // Antique gold
    { bg: '#1c1b17', colors: ['#b4a480', '#a89878', '#c0b08c', '#9c8e6c'], accent: '#d0c4a5' },
  ],
  light: [
    // Dusty rose
    { bg: '#f7f1f3', colors: ['#b07888', '#a06878', '#c08898', '#946272'], accent: '#8a4a60' },
    // Sea glass
    { bg: '#eff5f4', colors: ['#588880', '#488070', '#689890', '#3a7068'], accent: '#3a6058' },
    // Aged amber
    { bg: '#f5f3ee', colors: ['#9e8058', '#8e724c', '#ae8e64', '#7e6440'], accent: '#705030' },
    // Twilight lavender
    { bg: '#f3f1f7', colors: ['#7c6c96', '#6e5e88', '#8c7ca6', '#605278'], accent: '#524470' },
    // Sage botanical
    { bg: '#f0f5f0', colors: ['#5c8c5c', '#4e7e4e', '#6c9c6c', '#407040'], accent: '#386038' },
    // Porcelain blue
    { bg: '#f0f3f7', colors: ['#5c7c98', '#4e6e8a', '#6c8ca8', '#40607a'], accent: '#3a5468' },
    // Soft coral
    { bg: '#f7f3f1', colors: ['#a86a5c', '#9c5e50', '#b87a6c', '#8c5244'], accent: '#784030' },
    // Antique gold
    { bg: '#f5f4ee', colors: ['#8c7c54', '#80704a', '#987c60', '#746440'], accent: '#685830' },
  ],
}

interface GuillocheParams {
  palette: typeof GUILLOCHE_PALETTES[number]
  loops: Array<{
    a: number         // x frequency
    b: number         // y frequency
    delta: number     // phase offset
    scaleX: number
    scaleY: number
    copies: number
    scaleStep: number // scale increment per copy
    cx: number
    cy: number
    colorIdx: number
    opacity: number
    strokeWidth: number
  }>
  waveBands: Array<{
    baseY: number
    amplitude: number
    freq1: number
    freq2: number
    amp2Ratio: number
    phase: number
    copies: number
    spacing: number
    colorIdx: number
    opacity: number
  }>
}

// Lissajous frequency pairs — all produce smooth closed curves at t = 2π
const LISSAJOUS_RATIOS: [number, number][] = [
  [2, 3], [3, 4], [3, 5], [4, 5], [5, 6],
  [5, 7], [4, 7], [3, 7], [2, 5], [5, 8],
]

function generateGuillocheParams(id: string, mode: GuillocheMode): GuillocheParams {
  const rng = seededRng(hashString(id + ':guilloche'))
  const palettes = GUILLOCHE_PALETTES[mode]
  const palette = palettes[Math.abs(hashString(id)) % palettes.length]

  // 3-5 Lissajous loops, each rendered as a ribbon of concentric copies
  const loopCount = 3 + Math.floor(rng() * 3)
  const loops: GuillocheParams['loops'] = []

  for (let i = 0; i < loopCount; i++) {
    const [a, b] = LISSAJOUS_RATIOS[Math.floor(rng() * LISSAJOUS_RATIOS.length)]
    const baseScale = 80 + rng() * 50

    loops.push({
      a,
      b,
      delta: rng() * Math.PI * 2,
      scaleX: baseScale * (0.8 + rng() * 0.4),
      scaleY: baseScale * (0.8 + rng() * 0.4),
      copies: 6 + Math.floor(rng() * 6),
      scaleStep: 0.012 + rng() * 0.018,
      cx: (rng() - 0.5) * 30,
      cy: (rng() - 0.5) * 40,
      colorIdx: Math.floor(rng() * palette.colors.length),
      opacity: 0.14 + rng() * 0.18,
      strokeWidth: 0.18 + rng() * 0.14,
    })
  }

  // 4-7 flowing wave ribbon bands with compound sine
  const waveBandCount = 4 + Math.floor(rng() * 4)
  const waveBands: GuillocheParams['waveBands'] = []

  for (let i = 0; i < waveBandCount; i++) {
    waveBands.push({
      baseY: 8 + rng() * 84,
      amplitude: 10 + rng() * 22,
      freq1: 1.2 + rng() * 2.0,
      freq2: 0.4 + rng() * 1.2,
      amp2Ratio: 0.2 + rng() * 0.4,
      phase: rng() * Math.PI * 2,
      copies: 5 + Math.floor(rng() * 6),
      spacing: 1.0 + rng() * 1.5,
      colorIdx: Math.floor(rng() * palette.colors.length),
      opacity: 0.1 + rng() * 0.16,
    })
  }

  return { palette, loops, waveBands }
}

function generateLissajousPath(
  a: number, b: number, delta: number,
  cx: number, cy: number,
  scaleX: number, scaleY: number,
  steps: number,
): string {
  const points: string[] = []

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const x = cx + scaleX * Math.sin(a * t + delta)
    const y = cy + scaleY * Math.sin(b * t)
    points.push(i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`)
  }

  return points.join(' ') + 'Z'
}

function generateCompoundWavePath(
  amplitude: number, freq1: number, freq2: number, amp2Ratio: number,
  phase: number, y: number, width: number, steps: number,
): string {
  const points: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const px = t * width
    const py = y + amplitude * (
      Math.sin(freq1 * Math.PI * 2 * t + phase) +
      amp2Ratio * Math.sin(freq2 * Math.PI * 2 * t + phase * 1.7)
    )
    points.push(i === 0 ? `M${px.toFixed(2)},${py.toFixed(2)}` : `L${px.toFixed(2)},${py.toFixed(2)}`)
  }
  return points.join(' ')
}

export interface GuillocheData {
  palette: typeof GUILLOCHE_PALETTES[number]
  svgPaths: Array<{
    d: string
    color: string
    opacity: number
    strokeWidth: number
  }>
  wavePaths: Array<{
    d: string
    color: string
    opacity: number
  }>
}

export function generateGuilloche(id: string, width: number, height: number, mode: GuillocheMode = 'dark'): GuillocheData {
  const params = generateGuillocheParams(id, mode)
  const cx = width / 2
  const cy = height / 2

  const svgPaths: GuillocheData['svgPaths'] = []
  const wavePaths: GuillocheData['wavePaths'] = []

  // Render each Lissajous loop as a ribbon of concentric offset copies
  for (const loop of params.loops) {
    for (let c = 0; c < loop.copies; c++) {
      const scaleFactor = 1 + (c - (loop.copies - 1) / 2) * loop.scaleStep
      const d = generateLissajousPath(
        loop.a, loop.b, loop.delta,
        cx + loop.cx, cy + loop.cy,
        loop.scaleX * scaleFactor, loop.scaleY * scaleFactor,
        600,
      )
      const fadeFromCenter = Math.abs(c - (loop.copies - 1) / 2) / Math.max((loop.copies - 1) / 2, 1)
      svgPaths.push({
        d,
        color: params.palette.colors[loop.colorIdx],
        opacity: loop.opacity * (1 - fadeFromCenter * 0.35),
        strokeWidth: loop.strokeWidth,
      })
    }
  }

  // Render each wave band as a ribbon of parallel compound-sine curves
  for (const band of params.waveBands) {
    for (let c = 0; c < band.copies; c++) {
      const yOffset = (c - (band.copies - 1) / 2) * band.spacing
      const d = generateCompoundWavePath(
        band.amplitude * 0.9,
        band.freq1, band.freq2, band.amp2Ratio,
        band.phase,
        (band.baseY / 100) * height + yOffset,
        width, 300,
      )
      const fadeFromCenter = Math.abs(c - (band.copies - 1) / 2) / Math.max((band.copies - 1) / 2, 1)
      wavePaths.push({
        d,
        color: params.palette.colors[band.colorIdx],
        opacity: band.opacity * (1 - fadeFromCenter * 0.3),
      })
    }
  }

  return { palette: params.palette, svgPaths, wavePaths }
}

// ── Bubble system ─────────────────────────────────────

// Seeded PRNG (mulberry32)
function seededRng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return h
}

export type BubbleShape = 'circle' | 'rounded-rect' | 'hexagon' | 'ellipse' | 'diamond'

export interface Bubble {
  cx: number
  cy: number
  r: number
  color: string
  opacity: number
  shape: BubbleShape
  rotation: number
}

export interface BubbleSet {
  bg: string
  bubbles: Bubble[]
}

const TYPE_PALETTES: Record<string, { bg: string; colors: string[]; shape: BubbleShape }> = {
  character: {
    bg: 'oklch(0.42 0.06 15)',
    colors: ['oklch(0.68 0.17 10)', 'oklch(0.74 0.14 35)', 'oklch(0.63 0.15 350)', 'oklch(0.70 0.12 25)', 'oklch(0.78 0.10 50)'],
    shape: 'circle',
  },
  guideline: {
    bg: 'oklch(0.40 0.06 250)',
    colors: ['oklch(0.66 0.15 250)', 'oklch(0.72 0.12 220)', 'oklch(0.60 0.17 270)', 'oklch(0.76 0.10 200)', 'oklch(0.68 0.13 240)'],
    shape: 'rounded-rect',
  },
  knowledge: {
    bg: 'oklch(0.40 0.06 160)',
    colors: ['oklch(0.66 0.14 160)', 'oklch(0.72 0.12 140)', 'oklch(0.60 0.15 175)', 'oklch(0.76 0.10 150)', 'oklch(0.68 0.13 130)'],
    shape: 'hexagon',
  },
  prose: {
    bg: 'oklch(0.44 0.04 60)',
    colors: ['oklch(0.70 0.10 60)', 'oklch(0.65 0.08 45)', 'oklch(0.75 0.07 75)', 'oklch(0.62 0.11 50)', 'oklch(0.78 0.06 70)'],
    shape: 'ellipse',
  },
  image: {
    bg: 'oklch(0.40 0.06 300)',
    colors: ['oklch(0.66 0.15 300)', 'oklch(0.72 0.12 280)', 'oklch(0.60 0.14 320)', 'oklch(0.76 0.10 290)', 'oklch(0.68 0.15 310)'],
    shape: 'diamond',
  },
  marker: {
    bg: 'oklch(0.42 0.08 85)',
    colors: ['oklch(0.72 0.14 85)', 'oklch(0.78 0.12 70)', 'oklch(0.66 0.16 95)', 'oklch(0.80 0.10 75)', 'oklch(0.74 0.13 60)'],
    shape: 'diamond',
  },
}

export function generateBubbles(id: string, type: string): BubbleSet {
  const palette = TYPE_PALETTES[type] ?? TYPE_PALETTES.prose
  const rng = seededRng(hashString(id))
  const count = 4 + Math.floor(rng() * 3) // 4–6 bubbles

  const bubbles: Bubble[] = []
  for (let i = 0; i < count; i++) {
    bubbles.push({
      cx: rng() * 36,
      cy: rng() * 36,
      r: 5 + rng() * 12,
      color: palette.colors[Math.floor(rng() * palette.colors.length)],
      opacity: 0.35 + rng() * 0.45,
      shape: palette.shape,
      rotation: rng() * 360,
    })
  }

  return { bg: palette.bg, bubbles }
}

/** Renders a single bubble shape as an SVG element string-safe for JSX */
function hexagonPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`)
  }
  return pts.join(' ')
}

function diamondPoints(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r * 0.7},${cy} ${cx},${cy + r} ${cx - r * 0.7},${cy}`
}

export { hexagonPoints, diamondPoints }

export const CHARACTER_MENTION_COLORS = TYPE_PALETTES.character.colors

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
