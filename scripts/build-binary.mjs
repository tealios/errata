import { cp, mkdir, rm } from 'node:fs/promises'

function run(command, args) {
  const proc = Bun.spawnSync([command, ...args], {
    stdio: ['inherit', 'inherit', 'inherit'],
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

run('bun', ['run', 'build'])

await mkdir('dist', { recursive: true })
await rm('dist/public', { recursive: true, force: true })
await cp('.output/public', 'dist/public', { recursive: true })

const outputBase = await resolveOutputBase('dist/errata')

run('bun', ['build', '--compile', 'scripts/binary-entry.mjs', '--outfile', outputBase])

console.log(`Binary build complete: ${outputBase}.exe + dist/public`)
