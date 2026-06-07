import { cp, mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const pkg = JSON.parse(await readFile('package.json', 'utf-8'))
const version = pkg.version ?? '0.0.0'

// CLI flags:
//   --target=<bun-triple>   cross-compile target, e.g. bun-windows-x64, bun-darwin-arm64,
//                           bun-darwin-x64, bun-linux-x64. Omit to compile for the host.
//   --out-dir=<dir>         directory that receives the binary + public/ (default: dist).
//                           The Electron build passes --out-dir=dist/server so the binary
//                           and its assets land in one folder that becomes extraResources.
function parseFlags(argv) {
  const flags = {}
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg)
    if (match) flags[match[1]] = match[2]
  }
  return flags
}

const flags = parseFlags(process.argv.slice(2))
const target = flags.target ?? null
const outDir = flags['out-dir'] ?? 'dist'
const isWindowsTarget = target ? target.includes('windows') : process.platform === 'win32'

function run(command, args, env) {
  const proc = Bun.spawnSync([command, ...args], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
  })

  if (proc.exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${proc.exitCode}`)
  }
}

// The compiled .exe may be locked if a previous build is still running; fall back to a
// timestamped name rather than failing the whole build.
async function resolveOutputBase(preferredBase) {
  try {
    await rm(`${preferredBase}.exe`, { force: true })
    await rm(preferredBase, { force: true })
    return preferredBase
  } catch {
    const fallback = `${preferredBase}-${Date.now()}`
    console.warn(`Could not replace ${preferredBase} (likely in use). Writing fallback binary: ${fallback}`)
    return fallback
  }
}

console.log(`Building Errata v${version}${target ? ` (target ${target})` : ''} -> ${outDir}`)
run('bun', ['run', 'build'], { BUILD_VERSION: version })

await mkdir(outDir, { recursive: true })
const publicDir = join(outDir, 'public')
await rm(publicDir, { recursive: true, force: true })
await cp('.output/public', publicDir, { recursive: true })

const outputBase = await resolveOutputBase(join(outDir, 'errata'))

const compileArgs = ['build', '--compile']
if (target) compileArgs.push(`--target=${target}`)
compileArgs.push('--define', `globalThis.__ERRATA_VERSION__="${version}"`, 'scripts/binary-entry.mjs', '--outfile', outputBase)
run('bun', compileArgs)

const producedBinary = isWindowsTarget ? `${outputBase}.exe` : outputBase
console.log(`Binary build complete: ${producedBinary} + ${publicDir}`)
