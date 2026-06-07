/**
 * Build orchestrator for the Electron desktop app.
 *
 *   1. Compile the Bun server binary + static assets into dist/server (via build-binary).
 *   2. Bundle the Electron main + preload (electron-updater inlined) into dist-electron.
 *   3. Emit dist-electron/package.json: a minimal, dependency-free app manifest so the
 *      two-package structure keeps Errata's heavy server deps out of the asar.
 *   4. Stage the app icon into build/icon.png.
 *   5. Run electron-builder.
 *
 * Flags:
 *   --dir                 package unpacked only (no installer), for local smoke tests
 *   --publish=<mode>      electron-builder publish mode (never | onTag | always); default never
 *   --target=<bun-triple> cross-compile the server binary (default: host)
 *   --win | --mac | --linux  force an electron-builder platform (default: host OS)
 */
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile('package.json', 'utf-8'))
const version = pkg.version ?? '0.0.0'

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

const dirOnly = has('--dir')
const publishMode = valueOf('publish') ?? 'never'
const target = valueOf('target')
const platformFlag = ['--win', '--mac', '--linux'].find(has) ?? null

function run(command, args, env) {
  console.log(`> ${command} ${args.join(' ')}`)
  const proc = Bun.spawnSync([command, ...args], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
  })
  if (proc.exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${proc.exitCode}`)
  }
}

// 1. Server binary + assets -> dist/server/{errata(.exe),public}
const binaryArgs = ['scripts/build-binary.mjs', '--out-dir=dist/server']
if (target) binaryArgs.push(`--target=${target}`)
run('bun', binaryArgs)

// 2. Electron main + preload -> dist-electron/*.cjs (electron-updater bundled, electron external)
await rm('dist-electron', { recursive: true, force: true })
await mkdir('dist-electron', { recursive: true })
for (const entry of ['main', 'preload']) {
  run('bun', [
    'build',
    `desktop/${entry}.ts`,
    '--target=node',
    '--format=cjs',
    '--external=electron',
    '--outfile',
    `dist-electron/${entry}.cjs`,
  ])
}

// 3. Minimal app manifest (no dependencies -> no node_modules bundled into the asar)
const appManifest = {
  name: 'errata',
  productName: 'Errata',
  version,
  description: 'Model-assisted writing built around a fragment system.',
  author: 'Tealios',
  license: pkg.license ?? 'GPL-2.0',
  main: 'main.cjs',
  // The placeholder below must be a *declared* dependency: electron-builder builds the
  // production dependency tree from this file. With zero deps it reports "no node modules
  // found" and falls back to the root tree (dragging in onnxruntime/sharp/esbuild).
  dependencies: { 'errata-app-noop': '0.0.0' },
}
await writeFile('dist-electron/package.json', JSON.stringify(appManifest, null, 2))

// electron-builder's bun dependency collector copies node_modules by file traversal. With
// no node_modules in the app dir it falls back to the *root* tree and drags in the entire
// server dependency set (onnxruntime, sharp, esbuild, ...). We bundle electron-updater into
// main.cjs, so the app needs no runtime deps: plant a single tiny placeholder package so the
// collector finds the app dir's node_modules and stops there instead of traversing root.
await mkdir('dist-electron/node_modules/errata-app-noop', { recursive: true })
await writeFile(
  'dist-electron/node_modules/errata-app-noop/package.json',
  JSON.stringify({ name: 'errata-app-noop', version: '0.0.0', main: 'index.js' }, null, 2),
)
await writeFile('dist-electron/node_modules/errata-app-noop/index.js', 'module.exports = {}\n')

// 4. App icon for electron-builder (build/ is the buildResources dir).
await mkdir('build', { recursive: true })
await cp('public/ErrataLogo.png', 'build/icon.png')

// 5. electron-builder
const builderArgs = ['electron-builder', '--config', 'electron-builder.yml']
if (platformFlag) builderArgs.push(platformFlag)
if (dirOnly) {
  builderArgs.push('--dir')
} else {
  builderArgs.push(`--publish=${publishMode}`)
}
run('bunx', builderArgs)

console.log(`\nElectron build complete (v${version}). Output in ./release`)
