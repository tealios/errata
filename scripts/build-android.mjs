/**
 * Assemble the Android shell's web directory and sync it into the Capacitor project.
 *
 *   mobile/www/
 *     index.html            loader page (mobile/shell/index.html)
 *     nodejs/               Node project the embedded runtime boots
 *       package.json        main -> main.cjs
 *       main.cjs, boot.cjs  from mobile/node/
 *       server/             Nitro server bundle (.output/server)
 *       public/             built client assets (.output/public)
 *
 * Usage: bun scripts/build-android.mjs [--skip-build] [--no-sync] [--apk]
 *   --skip-build  reuse the existing .output instead of running `vite build`
 *   --no-sync     assemble only; skip `cap sync android`
 *   --apk         also run the Gradle debug build (needs Android SDK + NDK)
 */
import { cp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Env for the web/server build. Vite picks the JSX runtime from NODE_ENV, so an inherited
 * NODE_ENV=development yields a bundle full of jsxDEV calls that 500 on boot against the
 * production React runtime. Always build the APK bundle as production.
 */
export function productionBuildEnv(env = process.env) {
  return { ...env, NODE_ENV: 'production' }
}

/** Throw if any server chunk was compiled with the development JSX transform. */
async function assertProductionServerBundle(serverDir) {
  const entries = await readdir(serverDir, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
    const file = join(entry.parentPath ?? entry.path, entry.name)
    // Compiled JSX reaches the runtime through a module binding (`jsxDevRuntimeExports.jsxDEV(`).
    // Libraries like hast-util-to-jsx-runtime call a bare `jsxDEV(` param legitimately.
    if (/\.jsxDEV\(/.test(await readFile(file, 'utf8'))) {
      throw new Error(
        `Server bundle was built in development JSX mode (${file} calls jsxDEV). ` +
          'Rebuild with NODE_ENV=production (unset NODE_ENV, or drop --skip-build).',
      )
    }
  }
}

/**
 * Build mobile/www from a Nitro output directory. Pure filesystem work so it can be
 * tested against a fake .output. Returns the top-level entries written.
 */
export async function assembleMobileWww({
  root = REPO_ROOT,
  outputDir = join(root, '.output'),
  wwwDir = join(root, 'mobile', 'www'),
} = {}) {
  const serverDir = join(outputDir, 'server')
  const publicDir = join(outputDir, 'public')
  if (!(await exists(join(serverDir, 'index.mjs')))) {
    throw new Error(`No server bundle at ${serverDir}. Run \`bun run build\` first (or drop --skip-build).`)
  }
  if (!(await exists(publicDir))) {
    throw new Error(`No public assets at ${publicDir}. Run \`bun run build\` first.`)
  }
  await assertProductionServerBundle(serverDir)

  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const nodeDir = join(wwwDir, 'nodejs')

  // Start clean so removed chunks never linger in the APK.
  await rm(wwwDir, { recursive: true, force: true })
  await mkdir(nodeDir, { recursive: true })

  await cp(join(root, 'mobile', 'shell', 'index.html'), join(wwwDir, 'index.html'))
  await cp(join(root, 'mobile', 'node', 'main.cjs'), join(nodeDir, 'main.cjs'))
  await cp(join(root, 'mobile', 'node', 'boot.cjs'), join(nodeDir, 'boot.cjs'))
  await cp(serverDir, join(nodeDir, 'server'), { recursive: true })
  await cp(publicDir, join(nodeDir, 'public'), { recursive: true })
  if (await exists(join(outputDir, 'nitro.json'))) {
    await cp(join(outputDir, 'nitro.json'), join(nodeDir, 'nitro.json'))
  }

  await writeFile(
    join(nodeDir, 'package.json'),
    JSON.stringify(
      {
        name: 'errata-android-runtime',
        version: pkg.version,
        private: true,
        // The embedded runtime boots whatever `main` points at.
        main: 'main.cjs',
        errata: { builtAt: new Date().toISOString() },
      },
      null,
      2,
    ) + '\n',
  )

  return ['index.html', 'nodejs']
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: REPO_ROOT,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))

  if (!args.has('--skip-build')) {
    console.info('[android] building web + server bundle')
    run('bun', ['run', 'build'], { env: productionBuildEnv() })
  }

  console.info('[android] assembling mobile/www')
  await assembleMobileWww()

  if (!args.has('--no-sync')) {
    console.info('[android] cap sync android')
    run('bunx', ['cap', 'sync', 'android'])
  }

  if (args.has('--apk')) {
    console.info('[android] gradle assembleDebug')
    const gradlew = process.platform === 'win32' ? join(REPO_ROOT, 'android', 'gradlew.bat') : './gradlew'
    run(gradlew, ['assembleDebug'], { cwd: join(REPO_ROOT, 'android') })
    console.info('[android] APK: android/app/build/outputs/apk/debug/app-debug.apk')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
