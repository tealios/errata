import { promises as fsPromises } from 'node:fs'
import { dirname, join } from 'node:path'

const originalReadFile = fsPromises.readFile.bind(fsPromises)

function remapVirtualPublicPath(inputPath) {
  if (typeof inputPath !== 'string') return null

  const normalized = inputPath.replace(/\\/g, '/').toLowerCase()
  const marker = '/~bun/public/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex === -1) return null

  const relativePart = inputPath
    .replace(/\\/g, '/')
    .slice(markerIndex + marker.length)

  if (!relativePart) return null

  return join(dirname(process.execPath), 'public', relativePart)
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
