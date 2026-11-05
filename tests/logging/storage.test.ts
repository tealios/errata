import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createTempDir } from '../setup'
import { saveLogEntry, listLogs, getLogEntry, clearLogs } from '@/server/logging/storage'
import type { LogEntry } from '@/server/logging/types'

function entry(n: number): LogEntry {
  return {
    id: `log-${n}`,
    timestamp: new Date(1_700_000_000_000 + n).toISOString(),
    level: 'info',
    component: 'test',
    message: `m${n}`,
  } as LogEntry
}

describe('log storage', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
  })
  afterEach(async () => { await cleanup() })

  it('keeps every entry when writes are concurrent', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => saveLogEntry(dataDir, entry(i))))
    const logs = await listLogs(dataDir, { limit: 1000 })
    expect(logs).toHaveLength(50)
  })

  it('rotates, drops the oldest file and never grows past the cap', async () => {
    const total = 5 * 1000 + 250
    for (let start = 0; start < total; start += 250) {
      await Promise.all(
        Array.from({ length: Math.min(250, total - start) }, (_, i) => saveLogEntry(dataDir, entry(start + i))),
      )
    }
    const files = (await readdir(join(dataDir, 'logs'))).filter(f => f.startsWith('app-'))
    expect(files.sort()).toEqual(['app-0.jsonl', 'app-1.jsonl', 'app-2.jsonl', 'app-3.jsonl', 'app-4.jsonl'])

    let lines = 0
    for (const f of files) {
      lines += (await readFile(join(dataDir, 'logs', f), 'utf-8')).split('\n').filter(Boolean).length
    }
    expect(lines).toBeLessThanOrEqual(5000)
    // Oldest entries are gone, newest are kept
    expect(await getLogEntry(dataDir, 'log-0')).toBeNull()
    expect(await getLogEntry(dataDir, `log-${total - 1}`)).not.toBeNull()
    const last = (await readFile(join(dataDir, 'logs', 'app-4.jsonl'), 'utf-8')).split('\n').filter(Boolean)
    expect(last.length).toBeLessThanOrEqual(1000)
  }, 30_000)

  it('clearLogs empties files and resets the write position', async () => {
    await saveLogEntry(dataDir, entry(1))
    await clearLogs(dataDir)
    expect(await listLogs(dataDir)).toHaveLength(0)
    await saveLogEntry(dataDir, entry(2))
    expect(await listLogs(dataDir)).toHaveLength(1)
  })
})
