import { promises as fsPromises } from 'node:fs'
import { dirname, join } from 'node:path'

const ERRATA_VERSION = globalThis.__ERRATA_VERSION__ ?? 'unknown'

// --version flag
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`errata ${ERRATA_VERSION}`)
  process.exit(0)
}

const originalReadFile = fsPromises.readFile.bind(fsPromises)

const VIRTUAL_MARKERS = ['/~bun/public/', '/$bunfs/public/']

function remapVirtualPublicPath(inputPath) {
  if (typeof inputPath !== 'string') return null

  const normalized = inputPath.replace(/\\/g, '/').toLowerCase()

  for (const marker of VIRTUAL_MARKERS) {
    const markerIndex = normalized.indexOf(marker)
    if (markerIndex === -1) continue

    const relativePart = inputPath
      .replace(/\\/g, '/')
      .slice(markerIndex + marker.length)

    if (!relativePart) return null

    return join(dirname(process.execPath), 'public', relativePart)
  }

  return null
}

fsPromises.readFile = async (path, ...args) => {
  try {
    return await originalReadFile(path, ...args)
  } catch (error) {
    const remapped = remapVirtualPublicPath(path)
    if (!remapped) throw error
    return originalReadFile(remapped, ...args)
  }
}

await import('../.output/server/index.mjs')
