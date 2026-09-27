/**
 * Render the Android launcher PNGs and splash screens from the Errata mark.
 *
 * The adaptive icon (API 26+) is a vector drawable
 * (res/drawable-v24/ic_launcher_foreground.xml) and needs no PNGs; this script
 * covers the legacy launcher icons (API 24-25) and the Capacitor splash images.
 *
 * Usage: bun scripts/generate-android-icons.mjs   (needs ImageMagick `magick` on PATH)
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const RES = resolve(fileURLToPath(new URL('..', import.meta.url)), 'android/app/src/main/res')

// Keep in sync with values/ic_launcher_background.xml and ErrataMark (src/components/ErrataLogo.tsx).
const PARCHMENT = '#F8F6F4'
const INK = '#2D2520'
const PETAL = 'M 0 -8 C 1.6 -5.2 1.6 -1.2 0 0.8 C -1.6 -1.2 -1.6 -5.2 0 -8 Z'

/** The mark centred at (cx, cy) with primary-petal radius `r`. */
function mark(cx, cy, r) {
  const k = r / 8
  const petals = [0, 120, 240]
    .map((a) => `<path d="${PETAL}" transform="rotate(${a})"/>`)
    .concat([60, 180, 300].map((a) => `<path d="${PETAL}" transform="rotate(${a}) scale(0.7)"/>`))
  return `<g fill="${INK}" transform="translate(${cx} ${cy}) scale(${k})">${petals.join('')}<circle r="1.6"/></g>`
}

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
}

const tmp = await mkdtemp(join(tmpdir(), 'errata-icons-'))
let n = 0
async function render(svgText, out) {
  const src = join(tmp, `${n++}.svg`)
  await writeFile(src, svgText)
  execFileSync('magick', ['-background', 'none', src, '-strip', out])
}

try {
  // Legacy launcher icons: 48dp, mark radius 18dp (same proportion as the adaptive icon's visible 72dp).
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
  for (const [d, scale] of Object.entries(densities)) {
    const s = 48 * scale
    const inset = 2 * scale
    const r = 18 * scale
    const square = `<rect x="${inset}" y="${inset}" width="${s - 2 * inset}" height="${s - 2 * inset}" rx="${8 * scale}" fill="${PARCHMENT}"/>`
    const round = `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - inset}" fill="${PARCHMENT}"/>`
    await render(svg(s, s, square + mark(s / 2, s / 2, r)), join(RES, `mipmap-${d}`, 'ic_launcher.png'))
    await render(svg(s, s, round + mark(s / 2, s / 2, r)), join(RES, `mipmap-${d}`, 'ic_launcher_round.png'))
  }

  // Splash screens (pre-Android-12 path; 12+ draws the adaptive icon on windowSplashScreenBackground).
  const splashes = {
    drawable: [480, 320],
    'drawable-land-mdpi': [480, 320],
    'drawable-land-hdpi': [800, 480],
    'drawable-land-xhdpi': [1280, 720],
    'drawable-land-xxhdpi': [1600, 960],
    'drawable-land-xxxhdpi': [1920, 1280],
    'drawable-port-mdpi': [320, 480],
    'drawable-port-hdpi': [480, 800],
    'drawable-port-xhdpi': [720, 1280],
    'drawable-port-xxhdpi': [960, 1600],
    'drawable-port-xxxhdpi': [1280, 1920],
  }
  for (const [dir, [w, h]] of Object.entries(splashes)) {
    const r = Math.round(Math.min(w, h) * 0.12)
    const body = `<rect width="${w}" height="${h}" fill="${PARCHMENT}"/>` + mark(w / 2, h / 2, r)
    await render(svg(w, h, body), join(RES, dir, 'splash.png'))
  }
  console.log('android icons + splash rendered')
} finally {
  await rm(tmp, { recursive: true, force: true })
}
