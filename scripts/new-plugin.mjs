import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const TEMPLATE_ROOT = resolve('plugins/templates')
const DEFAULT_TEMPLATE = 'my-first-plugin'
const DEFAULT_PLUGINS_DIR = resolve('plugins')

async function listTemplateNames() {
  const entries = await readdir(TEMPLATE_ROOT, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function printUsage() {
  console.log('Usage: bun scripts/new-plugin.mjs <plugin-name> [target-dir] [--template <template-name>]')
  console.log('')
  console.log('Examples:')
  console.log('  bun scripts/new-plugin.mjs lore-tools')
  console.log('  bun scripts/new-plugin.mjs lore-tools C:/errata-plugins')
  console.log('  bun scripts/new-plugin.mjs lore-tools --template recipe-llm-tool-plugin')
}

function toTitleCase(name) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function validatePluginName(name) {
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(name)
}

async function walkFiles(dir) {
  const files = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

async function replaceInFile(filePath, replacements) {
  const text = await readFile(filePath, 'utf-8')
  let next = text
  for (const [from, to] of replacements) {
    next = next.split(from).join(to)
  }
  if (next !== text) {
    await writeFile(filePath, next)
  }
}

async function main() {
  const [, , pluginNameArg, ...restArgs] = Bun.argv

  if (!pluginNameArg || pluginNameArg === '--help' || pluginNameArg === '-h') {
    printUsage()
    process.exit(pluginNameArg ? 0 : 1)
  }

  const pluginName = pluginNameArg.trim().toLowerCase()
  if (!validatePluginName(pluginName)) {
    throw new Error('Invalid plugin name. Use lowercase letters, numbers, and dashes only (2-64 chars).')
  }

  let targetDirArg = null
  let templateName = DEFAULT_TEMPLATE

  for (let i = 0; i < restArgs.length; i++) {
    const arg = restArgs[i]
    if (arg === '--template') {
      const next = restArgs[i + 1]
      if (!next) throw new Error('Missing value for --template')
      templateName = next
      i++
      continue
    }

    if (!targetDirArg) {
      targetDirArg = arg
      continue
    }

    throw new Error(`Unexpected argument: ${arg}`)
  }

  const templates = await listTemplateNames()
  if (!templates.includes(templateName)) {
    throw new Error(`Unknown template "${templateName}". Available: ${templates.join(', ')}`)
  }

  const templateDir = join(TEMPLATE_ROOT, templateName)
  const targetRoot = targetDirArg ? resolve(targetDirArg) : DEFAULT_PLUGINS_DIR
  const targetDir = join(targetRoot, pluginName)

  await mkdir(targetRoot, { recursive: true })

  let exists = false
  try {
    await stat(targetDir)
    exists = true
  } catch {
    // Directory does not exist yet.
  }
  if (exists) {
    throw new Error(`Target already exists: ${targetDir}`)
  }

  await cp(templateDir, targetDir, { recursive: true })

  const title = toTitleCase(pluginName)
  const replacements = [
    ['my-plugin', pluginName],
    ['My Plugin', title],
  ]

  const files = await walkFiles(targetDir)
  for (const file of files) {
    if (file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.md')) {
      await replaceInFile(file, replacements)
    }
  }

  console.log(`Created plugin scaffold at: ${targetDir}`)
  console.log(`Template: ${templateName}`)
  console.log('Next steps:')
  console.log(`1) Set PLUGIN_DIR=${targetRoot}`)
  console.log('2) Start Errata and enable the plugin in story settings')
}

await main()
