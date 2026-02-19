import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

type Commit = {
  hash: string
  date: string
  subject: string
  files: string[]
}

type SyncState = {
  baselineCommit: string
  baselineDate: string
  baselineCoverage: number
  lastProcessedCommit: string
  updatedAt: string
}

const execFileAsync = promisify(execFile)

const STATE_PATH = path.join('.agent', 'docs-sync-state.json')
const OUTPUT_PATH = path.join('docs', 'commit-doc-sync.md')

const DOC_INCLUDE = [
  'docs/',
  'README.md',
  'PLAN.md',
  'BACKEND-STRESSTEST.md',
  'FRONTEND-STRESSTEST.md',
  'plugins/',
]

const DOC_EXCLUDE = [
  'AGENTS.md',
  'CLAUDE.md',
]

const DOC_HINTS: Array<{ pattern: RegExp; doc: string; reason: string }> = [
  { pattern: /^src\/components\/prose\//, doc: 'docs/prose-writing-panel.md', reason: 'Prose writing UI changes' },
  { pattern: /^src\/components\/character-chat\//, doc: 'docs/character-chat.md', reason: 'Character chat UI changes' },
  { pattern: /^src\/server\/librarian\//, doc: 'docs/summarization-and-memory.md', reason: 'Librarian/memory pipeline changes' },
  { pattern: /^src\/server\/routes\/(generation|prose-chain|fragments)\.ts$/, doc: 'docs/fragments-and-prose-chain.md', reason: 'Core generation/prose APIs changed' },
  { pattern: /^src\/server\/routes\/character-chat\.ts$/, doc: 'docs/character-chat.md', reason: 'Character chat API changed' },
  { pattern: /^src\/server\/routes\/branches\.ts$/, doc: 'docs/timelines.md', reason: 'Timeline APIs changed' },
  { pattern: /^src\/server\/routes\/blocks\.ts$/, doc: 'docs/context-blocks.md', reason: 'Context block APIs changed' },
  { pattern: /^plugins\//, doc: 'docs/third-party-plugins.md', reason: 'Plugin behavior changed' },
]

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { maxBuffer: 1024 * 1024 * 20 })
  return stdout.toString()
}

function isDocFile(filePath: string): boolean {
  if (!filePath.endsWith('.md')) return false
  if (DOC_EXCLUDE.includes(filePath)) return false
  return DOC_INCLUDE.some((prefix) => filePath === prefix || filePath.startsWith(prefix))
}

function parseCommitLog(raw: string): Commit[] {
  const lines = raw.split(/\r?\n/)
  const commits: Commit[] = []
  let current: Commit | null = null
  let mode: 'hash' | 'date' | 'subject' | 'files' = 'hash'

  for (const line of lines) {
    if (line === '__COMMIT__') {
      if (current) commits.push(current)
      current = { hash: '', date: '', subject: '', files: [] }
      mode = 'hash'
      continue
    }

    if (!current) continue

    if (mode === 'hash') {
      current.hash = line.trim()
      mode = 'date'
      continue
    }

    if (mode === 'date') {
      current.date = line.trim()
      mode = 'subject'
      continue
    }

    if (mode === 'subject') {
      current.subject = line.trim()
      mode = 'files'
      continue
    }

    const filePath = line.trim()
    if (filePath) current.files.push(filePath)
  }

  if (current) commits.push(current)
  return commits.filter((c) => c.hash)
}

async function listTrackedMarkdownFiles(): Promise<string[]> {
  const raw = await git(['ls-files'])
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isDocFile)
}

function suggestDocs(commits: Commit[]): Map<string, string[]> {
  const suggestions = new Map<string, Set<string>>()

  for (const commit of commits) {
    const hasDocChange = commit.files.some(isDocFile)
    if (hasDocChange) continue

    for (const filePath of commit.files) {
      for (const hint of DOC_HINTS) {
        if (!hint.pattern.test(filePath)) continue
        if (!suggestions.has(hint.doc)) suggestions.set(hint.doc, new Set())
        suggestions.get(hint.doc)!.add(`${hint.reason} (${commit.hash.slice(0, 7)})`)
      }
    }
  }

  const normalized = new Map<string, string[]>()
  for (const [doc, reasons] of suggestions.entries()) {
    normalized.set(doc, [...reasons].sort())
  }

  return normalized
}

function buildReport(params: {
  docsCount: number
  baseline: Commit
  baselineCoverage: number
  fromCommit: string
  toCommit: string
  commitsSinceBaseline: Commit[]
  suggestions: Map<string, string[]>
}): string {
  const {
    docsCount,
    baseline,
    baselineCoverage,
    fromCommit,
    toCommit,
    commitsSinceBaseline,
    suggestions,
  } = params

  const lines: string[] = []
  lines.push('# Commit-Driven Documentation Sync')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Baseline')
  lines.push('')
  lines.push(`- Baseline commit: \`${baseline.hash}\` (${baseline.date})`)
  lines.push(`- Baseline reason: this is the latest point where accumulated doc changes cover at least 50% of tracked docs.`)
  lines.push(`- Coverage at baseline: ${baselineCoverage.toFixed(1)}% (${Math.round((baselineCoverage / 100) * docsCount)}/${docsCount} docs)`)
  lines.push('')
  lines.push('## Sync Range')
  lines.push('')
  lines.push(`- From (exclusive): \`${fromCommit}\``)
  lines.push(`- To (inclusive): \`${toCommit}\``)
  lines.push(`- Commits inspected: ${commitsSinceBaseline.length}`)
  lines.push('')

  lines.push('## Commit Feed')
  lines.push('')
  if (commitsSinceBaseline.length === 0) {
    lines.push('- No commits since baseline.')
  } else {
    for (const commit of commitsSinceBaseline) {
      const docsTouched = commit.files.filter(isDocFile)
      const codeTouched = commit.files.filter((f) => !isDocFile(f)).slice(0, 5)
      lines.push(`- ${commit.date} \`${commit.hash.slice(0, 7)}\` ${commit.subject}`)
      lines.push(`  - Docs: ${docsTouched.length === 0 ? 'none' : docsTouched.join(', ')}`)
      lines.push(`  - Code: ${codeTouched.length === 0 ? 'none' : codeTouched.join(', ')}`)
    }
  }
  lines.push('')

  lines.push('## Suggested Doc Follow-ups')
  lines.push('')
  if (suggestions.size === 0) {
    lines.push('- No additional follow-ups detected.')
  } else {
    const sortedDocs = [...suggestions.keys()].sort()
    for (const doc of sortedDocs) {
      lines.push(`- [ ] \`${doc}\``)
      for (const reason of suggestions.get(doc) ?? []) {
        lines.push(`  - ${reason}`)
      }
    }
  }
  lines.push('')

  return lines.join('\n')
}

async function loadState(): Promise<SyncState | null> {
  try {
    const raw = await readFile(STATE_PATH, 'utf8')
    return JSON.parse(raw) as SyncState
  } catch {
    return null
  }
}

async function saveState(state: SyncState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true })
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const docs = await listTrackedMarkdownFiles()
  if (docs.length === 0) {
    throw new Error('No tracked documentation files found.')
  }

  const docLogRaw = await git([
    'log',
    '--date=short',
    '--pretty=format:__COMMIT__%n%H%n%ad%n%s',
    '--name-only',
    '--',
    '*.md',
  ])

  const docCommits = parseCommitLog(docLogRaw)
  if (docCommits.length === 0) {
    throw new Error('No documentation commits found.')
  }

  const threshold = Math.ceil(docs.length / 2)
  const touched = new Set<string>()
  let computedBaseline: Commit | null = null

  for (const commit of docCommits) {
    for (const filePath of commit.files) {
      if (isDocFile(filePath)) touched.add(filePath)
    }
    if (touched.size >= threshold) {
      computedBaseline = commit
      break
    }
  }

  if (!computedBaseline) {
    computedBaseline = docCommits[docCommits.length - 1]
  }

  const baselineCoverage = (touched.size / docs.length) * 100
  const currentHead = (await git(['rev-parse', 'HEAD'])).trim()
  const state = await loadState()

  const baselineCommit = state?.baselineCommit ?? computedBaseline.hash
  const baselineDate = state?.baselineDate ?? computedBaseline.date
  const baselineCoverageFromState = state?.baselineCoverage ?? baselineCoverage
  const fromCommit = state?.lastProcessedCommit ?? baselineCommit

  const rangeLogRaw = await git([
    'log',
    '--date=short',
    '--pretty=format:__COMMIT__%n%H%n%ad%n%s',
    '--name-only',
    `${fromCommit}..${currentHead}`,
  ])

  const commitsSinceBaseline = parseCommitLog(rangeLogRaw)
  const suggestions = suggestDocs(commitsSinceBaseline)

  const report = buildReport({
    docsCount: docs.length,
    baseline: { ...computedBaseline, hash: baselineCommit, date: baselineDate },
    baselineCoverage: baselineCoverageFromState,
    fromCommit,
    toCommit: currentHead,
    commitsSinceBaseline,
    suggestions,
  })

  await writeFile(OUTPUT_PATH, report, 'utf8')

  await saveState({
    baselineCommit,
    baselineDate,
    baselineCoverage: baselineCoverageFromState,
    lastProcessedCommit: currentHead,
    updatedAt: new Date().toISOString(),
  })

  console.log(`Docs sync complete: ${OUTPUT_PATH}`)
  console.log(`Baseline: ${baselineCommit.slice(0, 7)} (${baselineDate}), from ${fromCommit.slice(0, 7)} to ${currentHead.slice(0, 7)}`)
  console.log(`Commits inspected: ${commitsSinceBaseline.length}, suggestions: ${suggestions.size}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
