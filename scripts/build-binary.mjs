import { cp, mkdir, rm, readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile('package.json', 'utf-8'))
const version = pkg.version ?? '0.0.0'

function run(command, args, env) {
  const proc = Bun.spawnSync([command, ...args], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
  })

  if (proc.exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${proc.exitCode}`)
  }
}

async function resolveOutputBase(preferredBase) {
  try {
    await rm(`${preferredBase}.exe`, { force: true })
    await rm(preferredBase, { force: true })
    return preferredBase
  } catch {
    const fallback = `${preferredBase}-${Date.now()}`
    console.warn(`Could not replace ${preferredBase}.exe (likely in use). Writing fallback binary: ${fallback}.exe`)
    return fallback
  }
}

console.log(`Building Errata v${version}`)
run('bun', ['run', 'build'], { BUILD_VERSION: version })

await mkdir('dist', { recursive: true })
await rm('dist/public', { recursive: true, force: true })
await cp('.output/public', 'dist/public', { recursive: true })

const outputBase = await resolveOutputBase('dist/errata')

run('bun', ['build', '--compile', `--define`, `globalThis.__ERRATA_VERSION__="${version}"`, 'scripts/binary-entry.mjs', '--outfile', outputBase])

console.log(`Binary build complete: ${outputBase}.exe + dist/public`)
