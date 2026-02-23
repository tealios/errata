// Deterministic SVG cover generator — warm parchment / antiquarian aesthetic.
// Generates delicate, engraving-like compositions seeded from a string token.

// ── Seedable PRNG ──────────────────────────────────────

function xmur3(str: string) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 345227121)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
  }
}

function sfc32(a: number, b: number, c: number, d: number) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    const t = ((a + b) | 0) + d | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

function createRng(token: string) {
  const seed = xmur3(token)
  return sfc32(seed(), seed(), seed(), seed())
}

// ── Palettes ───────────────────────────────────────────

export type CoverMode = 'light' | 'dark'

const LIGHT_PALETTES = [
  ['#fcf5e5', '#3c2f2f', '#704214', '#a67b5b', '#4b3621'], // Vintage Sepia
  ['#faf0e6', '#2b3a3a', '#b08d57', '#8b7355', '#4a443a'], // Aged Scholar
  ['#fdf6e3', '#073642', '#b58900', '#cb4b16', '#dc322f'], // Solarized Gold
  ['#eee8d5', '#586e75', '#002b36', '#859900', '#268bd2'], // Deep Parchment
  ['#fffcf2', '#252422', '#eb5e28', '#ccc5b9', '#403d39'], // High Contrast Ochre
  ['#f4ede3', '#3d3d3d', '#96705b', '#c4a484', '#6b4e3d'], // Driftwood & Dust
]

const DARK_PALETTES = [
  ['#1c1814', '#c9b99a', '#a08060', '#d4b896', '#8a7050'], // Aged Leather
  ['#1a1816', '#b8a888', '#c4a06c', '#9c8868', '#d0bc98'], // Dark Walnut
  ['#181c1a', '#8aaa96', '#a0c0ac', '#6e907c', '#b8d0c0'], // Midnight Botanical
  ['#1c1a1e', '#a898b0', '#c0b0c8', '#887898', '#d0c4d4'], // Dusty Plum Binding
  ['#1a1610', '#c8a870', '#b09050', '#d8bc88', '#907440'], // Lamplight Study
  ['#181a1c', '#90a0a8', '#a8b8c0', '#708088', '#c0ccd0'], // Steel Engraving
]

// ── Drawing primitives — delicate, engraving-like ───────

type DrawFn = (c: string, rand: () => number) => string

const celestialFuncs: DrawFn[] = [
  (c, r) => `<circle cx="200" cy="300" r="${50 + r() * 130}" stroke="${c}" fill="none" stroke-width="0.5" stroke-dasharray="${r() > 0.5 ? '2 2' : ''}"/>`,
  (c, r) => `<circle cx="${r() * 400}" cy="${r() * 600}" r="${8 + r() * 30}" fill="${c}" fill-opacity="0.12"/>`,
  (c, r) => {
    const cx = 200, cy = 300, rx = 140 + r() * 40, ry = 60 + r() * 40
    const rot = r() * 360
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${c}" fill="none" stroke-width="0.3" transform="rotate(${rot} ${cx} ${cy})" opacity="0.6"/>`
  },
  (c, r) => {
    const x = 200, y = 300
    let g = `<g stroke="${c}" stroke-width="0.2" opacity="0.4">`
    for (let i = 0; i < 48; i++) {
      const ang = (i / 48) * Math.PI * 2
      const rInner = 20 + r() * 40
      const rOuter = 80 + r() * 120
      g += `<line x1="${x + Math.cos(ang) * rInner}" y1="${y + Math.sin(ang) * rInner}" x2="${x + Math.cos(ang) * rOuter}" y2="${y + Math.sin(ang) * rOuter}"/>`
    }
    return g + '</g>'
  },
  (c, r) => `<path d="M ${r() * 400} ${r() * 600} a 40 40 0 1 1 80 0" stroke="${c}" stroke-width="0.4" fill="none" opacity="0.5"/>`,
]

const flowFuncs: DrawFn[] = [
  (c, r) => {
    const y = 350 + r() * 150, amp = 10 + r() * 20
    let d = `M -20 ${y}`
    for (let x = -20; x <= 420; x += 15) d += ` Q ${x + 7.5} ${y - amp} ${x + 15} ${y}`
    return `<path d="${d}" stroke="${c}" fill="none" stroke-width="1" stroke-opacity="0.7"/>`
  },
  (c, r) => {
    const x = 50 + r() * 300
    return `<line x1="${x}" y1="50" x2="${x}" y2="550" stroke="${c}" stroke-width="0.2" opacity="0.25"/>`
  },
  (c, r) => {
    const x = r() * 300, y = r() * 500
    let g = `<g stroke="${c}" stroke-width="0.15" opacity="0.2">`
    for (let i = 0; i < 12; i++) {
      g += `<line x1="${x + i * 4}" y1="${y}" x2="${x + i * 4 - 8}" y2="${y + 25}"/>`
      g += `<line x1="${x}" y1="${y + i * 4}" x2="${x + 25}" y2="${y + i * 4 - 8}"/>`
    }
    return g + '</g>'
  },
  (c) => `<rect x="35" y="35" width="330" height="530" stroke="${c}" fill="none" stroke-width="0.3" opacity="0.3"/>`,
]

const mathFuncs: DrawFn[] = [
  (c, r) => {
    const rad = 100 + r() * 80
    return `<g stroke="${c}" fill="none" stroke-width="0.4" opacity="0.6"><circle cx="200" cy="300" r="${rad}"/><rect x="${200 - rad}" y="${300 - rad}" width="${rad * 2}" height="${rad * 2}"/><line x1="${200 - rad}" y1="${300 - rad}" x2="${200 + rad}" y2="${300 + rad}"/><line x1="${200 + rad}" y1="${300 - rad}" x2="${200 - rad}" y2="${300 + rad}"/></g>`
  },
  (c) => {
    let d = 'M 200 300'
    for (let i = 0; i < 60; i++) {
      const ang = 0.5 * i
      const rad = 1.2 * Math.pow(1.12, i)
      d += ` L ${200 + rad * Math.cos(ang)} ${300 + rad * Math.sin(ang)}`
    }
    return `<path d="${d}" stroke="${c}" fill="none" stroke-width="0.5" opacity="0.4"/>`
  },
]

const terrainFuncs: DrawFn[] = [
  (c, r) => {
    const base = 480 + r() * 80
    let d = `M -20 ${base}`
    for (let x = -20; x <= 420; x += 40) d += ` L ${x} ${base - r() * 100}`
    return `<path d="${d}" stroke="${c}" fill="none" stroke-width="0.8" stroke-opacity="0.5"/>`
  },
  (c, r) => {
    const x = 100 + r() * 200, y = 250 + r() * 100, w = 150 + r() * 150
    return `<path d="M ${x - w / 2} ${y + 200} L ${x} ${y} L ${x + w / 2} ${y + 200} Z" fill="${c}" fill-opacity="0.05" stroke="${c}" stroke-width="0.2"/>`
  },
]

const STYLE_PROFILES = ['celestial', 'flow', 'math', 'terrain'] as const
const STYLE_POOLS: Record<string, DrawFn[]> = {
  celestial: celestialFuncs,
  flow: flowFuncs,
  math: mathFuncs,
  terrain: terrainFuncs,
}

// ── Generation ─────────────────────────────────────────

function generateSvgContent(token: string, mode: CoverMode): string {
  const rand = createRng(token)

  const palettes = mode === 'dark' ? DARK_PALETTES : LIGHT_PALETTES
  const palette = palettes[Math.floor(rand() * palettes.length)]
  const bg = palette[0]
  const fgColors = palette.slice(1)

  // Pick a random style profile (not mixed)
  const profile = STYLE_PROFILES[Math.floor(rand() * STYLE_PROFILES.length)]
  const pool = STYLE_POOLS[profile]

  let content = `<rect width="400" height="600" fill="${bg}"/>`

  // Paper grain texture — multiply blend for light, soft-light for dark
  const blendMode = mode === 'dark' ? 'soft-light' : 'multiply'
  const grainOpacity = mode === 'dark' ? '0.3' : '0.4'
  content += `<filter id="inkGrain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.2"/></feComponentTransfer></filter>`
  content += `<rect width="400" height="600" filter="url(#inkGrain)" opacity="${grainOpacity}" style="mix-blend-mode: ${blendMode};"/>`

  // Density fixed at 2 → layerCount = 2*2 + 3 + rand(0..3) = 7..10
  const layerCount = 2 * 2 + 3 + Math.floor(rand() * 4)

  for (let i = 0; i < layerCount; i++) {
    const drawFunc = pool[Math.floor(rand() * pool.length)]
    const color = fgColors[Math.floor(rand() * fgColors.length)]
    content += drawFunc(color, rand)
  }

  // Antiquarian frontispiece frame
  if (rand() > 0.4) {
    const accent = fgColors[0]
    content += `<g opacity="0.7"><rect x="25" y="25" width="350" height="550" fill="none" stroke="${accent}" stroke-width="1.5"/><rect x="30" y="30" width="340" height="540" fill="none" stroke="${accent}" stroke-width="0.5"/></g>`
  }

  return content
}

/**
 * Generate a full `<svg>` string for use as a story cover.
 * Deterministic: same token + mode always produces the same image.
 */
export function generateCoverSvg(token: string, mode: CoverMode = 'dark'): string {
  const inner = generateSvgContent(token, mode)
  return `<svg viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
}

// ── Cache ──────────────────────────────────────────────

const cache = new Map<string, string>()

/**
 * Returns a data URI for the generated cover SVG, with memoization.
 */
export function getCoverDataUri(token: string, mode: CoverMode = 'dark'): string {
  const key = `uri::${mode}::${token}`
  const cached = cache.get(key)
  if (cached) return cached

  const svg = generateCoverSvg(token, mode)
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  cache.set(key, uri)
  return uri
}

/**
 * Returns raw SVG markup for inline rendering via `dangerouslySetInnerHTML`.
 */
export function getCoverSvgMarkup(token: string, mode: CoverMode = 'dark'): string {
  const key = `markup::${mode}::${token}`
  const cached = cache.get(key)
  if (cached) return cached

  const svg = generateSvgContent(token, mode)
  cache.set(key, svg)
  return svg
}
