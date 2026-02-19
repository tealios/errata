import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createStory, createFragment } from '../src/server/fragments/storage'
import { addProseSection } from '../src/server/fragments/prose-chain'
import { buildContextState } from '../src/server/llm/context-builder'
import {
  saveAnalysis,
  getAnalysis,
  listAnalyses,
  selectLatestAnalysesByFragment,
  getLatestAnalysisIdsByFragment,
  getAnalysisIndex,
  type LibrarianAnalysis,
} from '../src/server/librarian/storage'

type CompactType = 'proseLimit' | 'maxTokens' | 'maxCharacters'

interface HarnessOptions {
  proseCount: number
  nonProseCount: number
  reanalysisRatio: number
  chapterEvery: number
  runs: number
  warmups: number
  compactType: CompactType
  compactValue: number
  targetOffsetFromEnd: number
}

interface TimingStats {
  label: string
  runs: number
  p50Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
  meanMs: number
}

interface HarnessReport {
  options: HarnessOptions
  generated: {
    proseCount: number
    markerCount: number
    nonProseCount: number
    analysisCount: number
    reanalysisCount: number
    indexEntryCount: number
  }
  correctness: {
    summaryRebuildMatchesLegacy: boolean
    summaryLengthChars: number
  }
  timings: TimingStats[]
  indexSpeedupVsLegacySummaryRebuild: number
}

const DEFAULTS: HarnessOptions = {
  proseCount: 2000,
  nonProseCount: 500,
  reanalysisRatio: 0.1,
  chapterEvery: 50,
  runs: 20,
  warmups: 3,
  compactType: 'proseLimit',
  compactValue: 10,
  targetOffsetFromEnd: 5,
}

function parseArgs(argv: string[]): HarnessOptions {
  const opts = { ...DEFAULTS }

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const [rawKey, rawValue] = arg.slice(2).split('=')
    const key = rawKey.trim()
    const value = (rawValue ?? '').trim()
    if (!value) continue

    switch (key) {
      case 'prose':
        opts.proseCount = Math.max(1, Number.parseInt(value, 10) || opts.proseCount)
        break
      case 'nonProse':
        opts.nonProseCount = Math.max(0, Number.parseInt(value, 10) || opts.nonProseCount)
        break
      case 'reanalysisRatio':
        opts.reanalysisRatio = Math.max(0, Math.min(1, Number.parseFloat(value) || opts.reanalysisRatio))
        break
      case 'chapterEvery':
        opts.chapterEvery = Math.max(1, Number.parseInt(value, 10) || opts.chapterEvery)
        break
      case 'runs':
        opts.runs = Math.max(1, Number.parseInt(value, 10) || opts.runs)
        break
      case 'warmups':
        opts.warmups = Math.max(0, Number.parseInt(value, 10) || opts.warmups)
        break
      case 'compactType': {
        const next = value as CompactType
        if (next === 'proseLimit' || next === 'maxTokens' || next === 'maxCharacters') {
          opts.compactType = next
        }
        break
      }
      case 'compactValue':
        opts.compactValue = Math.max(1, Number.parseInt(value, 10) || opts.compactValue)
        break
      case 'targetOffset':
        opts.targetOffsetFromEnd = Math.max(1, Number.parseInt(value, 10) || opts.targetOffsetFromEnd)
        break
    }
  }

  return opts
}

function isoAt(offsetMs: number): string {
  return new Date(Date.UTC(2025, 0, 1, 0, 0, 0, offsetMs)).toISOString()
}

function fragmentId(prefix: string, n: number): string {
  return `${prefix}-${n.toString(36).padStart(6, '0')}`
}

function makeProseContent(n: number): string {
  const base = `Section ${n}: The party advances through the ruins, tracks clues, and negotiates fragile alliances.`
  const motif = ` This passage records pressure, stakes, and continuity anchor ${n % 17}.`
  return `${base}${motif}`
}

function makeSummaryUpdate(n: number, variant = 'base'): string {
  const suffix = variant === 'reanalysis' ? 'Refined details replace older interpretation.' : 'Initial synthesis recorded.'
  return `Event ${n}: Characters resolve conflict beat ${n % 13}. ${suffix}`
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

function toTimingStats(label: string, values: number[]): TimingStats {
  return {
    label,
    runs: values.length,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
    meanMs: mean(values),
  }
}

async function benchmark(label: string, runs: number, warmups: number, fn: () => Promise<void>): Promise<TimingStats> {
  for (let i = 0; i < warmups; i += 1) {
    await fn()
  }

  const times: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now()
    await fn()
    times.push(performance.now() - start)
  }

  return toTimingStats(label, times)
}

async function summaryBeforeLegacy(
  dataDir: string,
  storyId: string,
  orderedFragmentIds: string[],
): Promise<string> {
  const summaries = await listAnalyses(dataDir, storyId)
  const latestByFragment = selectLatestAnalysesByFragment(summaries)

  const analysisIds = orderedFragmentIds
    .map((fragmentId) => latestByFragment.get(fragmentId)?.id)
    .filter((analysisId): analysisId is string => !!analysisId)

  const analyses = await Promise.all(analysisIds.map((analysisId) => getAnalysis(dataDir, storyId, analysisId)))
  const updates = analyses
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => a.summaryUpdate.trim())
    .filter((s) => s.length > 0)

  return updates.join(' ').trim()
}

async function summaryBeforeIndexed(
  dataDir: string,
  storyId: string,
  orderedFragmentIds: string[],
): Promise<string> {
  const latestByFragment = await getLatestAnalysisIdsByFragment(dataDir, storyId)
  const analysisIds = orderedFragmentIds
    .map((fragmentId) => latestByFragment.get(fragmentId))
    .filter((analysisId): analysisId is string => !!analysisId)

  const analyses = await Promise.all(analysisIds.map((analysisId) => getAnalysis(dataDir, storyId, analysisId)))
  const updates = analyses
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => a.summaryUpdate.trim())
    .filter((s) => s.length > 0)

  return updates.join(' ').trim()
}

async function seedStory(dataDir: string, options: HarnessOptions): Promise<{
  storyId: string
  proseIds: string[]
  markerCount: number
  analysisCount: number
  reanalysisCount: number
}> {
  const storyId = 'stress-story'
  const now = new Date().toISOString()

  await createStory(dataDir, {
    id: storyId,
    name: 'Stress Story',
    description: 'Synthetic story for backend stress harness',
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: {
      outputFormat: 'markdown',
      enabledPlugins: [],
      summarizationThreshold: 4,
      maxSteps: 10,
      providerId: null,
      modelId: null,
      librarianProviderId: null,
      librarianModelId: null,
      autoApplyLibrarianSuggestions: false,
      contextOrderMode: 'simple',
      fragmentOrder: [],
      enabledBuiltinTools: [],
      contextCompact: { type: options.compactType, value: options.compactValue },
      summaryCompact: { maxCharacters: 12000, targetCharacters: 9000 },
      enableHierarchicalSummary: true,
      characterChatProviderId: null,
      characterChatModelId: null,
      proseTransformProviderId: null,
      proseTransformModelId: null,
      librarianChatProviderId: null,
      librarianChatModelId: null,
      librarianRefineProviderId: null,
      librarianRefineModelId: null,
    },
  })

  const proseIds: string[] = []
  let markerCount = 0
  let analysisCount = 0

  for (let i = 1; i <= options.proseCount; i += 1) {
    if ((i - 1) % options.chapterEvery === 0) {
      markerCount += 1
      const markerId = fragmentId('mk', markerCount)
      await createFragment(dataDir, storyId, {
        id: markerId,
        type: 'marker',
        name: `Chapter ${markerCount}`,
        description: `Chapter marker ${markerCount}`,
        content: `Chapter ${markerCount} summary: major arc transition around section ${i}.`,
        tags: [],
        refs: [],
        sticky: false,
        placement: 'user',
        createdAt: isoAt(i * 1000 - 1),
        updatedAt: isoAt(i * 1000 - 1),
        order: i,
        meta: {},
        archived: false,
        version: 1,
        versions: [],
      })
      await addProseSection(dataDir, storyId, markerId)
    }

    const proseId = fragmentId('pr', i)
    proseIds.push(proseId)
    await createFragment(dataDir, storyId, {
      id: proseId,
      type: 'prose',
      name: `Prose ${i}`,
      description: `Synthetic prose section ${i}`,
      content: makeProseContent(i),
      tags: [],
      refs: [],
      sticky: false,
      placement: 'user',
      createdAt: isoAt(i * 1000),
      updatedAt: isoAt(i * 1000),
      order: i,
      meta: {},
      archived: false,
      version: 1,
      versions: [],
    })
    await addProseSection(dataDir, storyId, proseId)

    const analysis: LibrarianAnalysis = {
      id: fragmentId('la', i),
      createdAt: isoAt(i * 1000 + 10),
      fragmentId: proseId,
      summaryUpdate: makeSummaryUpdate(i),
      structuredSummary: {
        events: [`Event beat ${i}`],
        stateChanges: [`State shift ${i % 11}`],
        openThreads: [`Open thread ${i % 7}`],
      },
      mentionedCharacters: [],
      contradictions: [],
      knowledgeSuggestions: [],
      timelineEvents: [],
    }
    await saveAnalysis(dataDir, storyId, analysis)
    analysisCount += 1
  }

  for (let i = 1; i <= options.nonProseCount; i += 1) {
    const type = i % 3 === 0 ? 'guideline' : i % 2 === 0 ? 'knowledge' : 'character'
    const prefix = type === 'guideline' ? 'gl' : type === 'knowledge' ? 'kn' : 'ch'
    await createFragment(dataDir, storyId, {
      id: fragmentId(prefix, i),
      type,
      name: `${type} ${i}`,
      description: `Synthetic ${type} fragment ${i}`,
      content: `Synthetic ${type} content ${i}.`,
      tags: [],
      refs: [],
      sticky: i % 25 === 0,
      placement: 'user',
      createdAt: isoAt(3_000_000 + i),
      updatedAt: isoAt(3_000_000 + i),
      order: i,
      meta: {},
      archived: false,
      version: 1,
      versions: [],
    })
  }

  const reanalysisCount = Math.floor(options.proseCount * options.reanalysisRatio)
  if (reanalysisCount > 0) {
    const stride = Math.max(1, Math.floor(options.proseCount / reanalysisCount))
    let created = 0
    for (let i = 1; i <= options.proseCount && created < reanalysisCount; i += stride) {
      const proseId = fragmentId('pr', i)
      const analysis: LibrarianAnalysis = {
        id: fragmentId('la', options.proseCount + created + 1),
        createdAt: isoAt(5_000_000 + created),
        fragmentId: proseId,
        summaryUpdate: makeSummaryUpdate(i, 'reanalysis'),
        structuredSummary: {
          events: [`Reanalysis event ${i}`],
          stateChanges: [`Reanalysis state ${i % 11}`],
          openThreads: [`Reanalysis thread ${i % 7}`],
        },
        mentionedCharacters: [],
        contradictions: [],
        knowledgeSuggestions: [],
        timelineEvents: [],
      }
      await saveAnalysis(dataDir, storyId, analysis)
      created += 1
      analysisCount += 1
    }
  }

  return { storyId, proseIds, markerCount, analysisCount, reanalysisCount }
}

function formatMs(v: number): string {
  return `${v.toFixed(2)} ms`
}

function printStatsTable(stats: TimingStats[]): void {
  const header = ['Metric', 'p50', 'p95', 'mean', 'min', 'max']
  const rows = stats.map((s) => [
    s.label,
    formatMs(s.p50Ms),
    formatMs(s.p95Ms),
    formatMs(s.meanMs),
    formatMs(s.minMs),
    formatMs(s.maxMs),
  ])

  const allRows = [header, ...rows]
  const widths = header.map((_, i) => Math.max(...allRows.map((r) => r[i].length)))
  const render = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join(' | ')

  console.log(render(header))
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'))
  for (const row of rows) {
    console.log(render(row))
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const dataDir = await mkdtemp(join(tmpdir(), 'errata-stress-'))

  try {
    console.log('Seeding synthetic stress fixture...')
    const seeded = await seedStory(dataDir, options)
    const targetIndex = Math.max(1, seeded.proseIds.length - options.targetOffsetFromEnd)
    const targetFragmentId = seeded.proseIds[targetIndex]
    const beforeTarget = seeded.proseIds.slice(0, targetIndex)

    const legacySummary = await summaryBeforeLegacy(dataDir, seeded.storyId, beforeTarget)
    const indexedSummary = await summaryBeforeIndexed(dataDir, seeded.storyId, beforeTarget)

    const legacySummaryStats = await benchmark(
      'summaryBefore (legacy scan)',
      options.runs,
      options.warmups,
      async () => {
        await summaryBeforeLegacy(dataDir, seeded.storyId, beforeTarget)
      },
    )

    const indexedSummaryStats = await benchmark(
      'summaryBefore (index)',
      options.runs,
      options.warmups,
      async () => {
        await summaryBeforeIndexed(dataDir, seeded.storyId, beforeTarget)
      },
    )

    const buildContextStats = await benchmark(
      'buildContextState (normal)',
      options.runs,
      options.warmups,
      async () => {
        await buildContextState(dataDir, seeded.storyId, 'Continue the story naturally.')
      },
    )

    const rebuildContextStats = await benchmark(
      'buildContextState (regenerate path)',
      options.runs,
      options.warmups,
      async () => {
        await buildContextState(dataDir, seeded.storyId, 'Regenerate current section.', {
          proseBeforeFragmentId: targetFragmentId,
          summaryBeforeFragmentId: targetFragmentId,
          excludeFragmentId: targetFragmentId,
        })
      },
    )

    const index = await getAnalysisIndex(dataDir, seeded.storyId)
    const indexEntryCount = index ? Object.keys(index.latestByFragmentId).length : 0

    const report: HarnessReport = {
      options,
      generated: {
        proseCount: seeded.proseIds.length,
        markerCount: seeded.markerCount,
        nonProseCount: options.nonProseCount,
        analysisCount: seeded.analysisCount,
        reanalysisCount: seeded.reanalysisCount,
        indexEntryCount,
      },
      correctness: {
        summaryRebuildMatchesLegacy: legacySummary === indexedSummary,
        summaryLengthChars: indexedSummary.length,
      },
      timings: [legacySummaryStats, indexedSummaryStats, buildContextStats, rebuildContextStats],
      indexSpeedupVsLegacySummaryRebuild:
        indexedSummaryStats.meanMs > 0 ? legacySummaryStats.meanMs / indexedSummaryStats.meanMs : 0,
    }

    console.log('')
    console.log('Backend stress harness report')
    console.log(`Fixture: prose=${report.generated.proseCount}, analyses=${report.generated.analysisCount}, reanalysis=${report.generated.reanalysisCount}, nonProse=${report.generated.nonProseCount}`)
    console.log(`Index entries: ${report.generated.indexEntryCount}`)
    console.log(`Summary parity (legacy vs index): ${report.correctness.summaryRebuildMatchesLegacy ? 'PASS' : 'FAIL'}`)
    console.log(`Summary length before target: ${report.correctness.summaryLengthChars} chars`)
    console.log(`Index speedup (mean): ${report.indexSpeedupVsLegacySummaryRebuild.toFixed(2)}x`)
    console.log('')
    printStatsTable(report.timings)
    console.log('')
    console.log('JSON_REPORT_START')
    console.log(JSON.stringify(report, null, 2))
    console.log('JSON_REPORT_END')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('Stress harness failed:', error)
  process.exitCode = 1
})
