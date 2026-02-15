import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'

const distDir = resolve('dist')

async function listFilesRecursive(rootDir) {
  const out = []

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        out.push(fullPath)
      }
    }
  }

  await walk(rootDir)
  return out
}

async function findLatestBinary() {
  const entries = await readdir(distDir, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.isFile() && /^errata.*\.exe$/i.test(entry.name))
    .map((entry) => join(distDir, entry.name))

  if (candidates.length === 0) {
    throw new Error('No binary found in dist/. Run "bun run build:binary" first.')
  }

  let latestPath = candidates[0]
  let latestMtime = (await stat(latestPath)).mtimeMs

  for (const candidate of candidates.slice(1)) {
    const mtime = (await stat(candidate)).mtimeMs
    if (mtime > latestMtime) {
      latestMtime = mtime
      latestPath = candidate
    }
  }

  return latestPath
}

async function main() {
  const binaryPath = await findLatestBinary()
  const publicDir = join(distDir, 'public')

  const filesForZip = {}

  const binaryName = relative(distDir, binaryPath).replace(/\\/g, '/')
  filesForZip[binaryName] = new Uint8Array(await readFile(binaryPath))

  const publicFiles = await listFilesRecursive(publicDir)
  for (const fullPath of publicFiles) {
    const rel = relative(distDir, fullPath).replace(/\\/g, '/')
    filesForZip[rel] = new Uint8Array(await readFile(fullPath))
  }

  filesForZip['README.txt'] = strToU8(
    [
      'Errata binary bundle',
      '',
      `Included binary: ${binaryName}`,
      'Required static assets are in ./public.',
      '',
      'Run on Windows:',
      `  .\\${binaryName}`,
      '',
      'Optional environment variables:',
      '  DATA_DIR=<path>',
      '  PLUGIN_DIR=<path>',
      '  PLUGIN_EXTERNAL_OVERRIDE=1',
      '  PORT=3000',
    ].join('\n'),
  )

  const zipData = zipSync(filesForZip, { level: 9 })
  const zipPath = join(distDir, 'errata-bundle.zip')
  await Bun.write(zipPath, zipData)

  console.log(`Packaged ${binaryName} + public/* -> ${zipPath}`)
}

await main()
