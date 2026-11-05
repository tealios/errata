import { tool } from 'ai'
import { z } from 'zod/v4'
import { t } from 'elysia'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { WritingPlugin } from '@tealios/errata-plugin-sdk'

interface LogEntry {
  type: 'should' | 'roll'
  question?: string
  answer?: string
  min?: number
  max?: number
  result?: number
  for?: string
  timestamp: string
}

// Same shape as the server's story-id validator (src/server/safe-id.ts); kept
// local so the plugin stays self-contained.
const STORY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function isValidStoryId(id: unknown): id is string {
  return typeof id === 'string' && STORY_ID_RE.test(id)
}

// Per-story promise chain so concurrent tool calls don't lose log entries.
const logTails = new Map<string, Promise<unknown>>()

function withLogLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = logTails.get(key) ?? Promise.resolve()
  const result = prev.then(fn, fn)
  const tail = result.then(() => {}, () => {})
  logTails.set(key, tail)
  void tail.then(() => {
    if (logTails.get(key) === tail) logTails.delete(key)
  })
  return result
}

function getDataDir(): string {
  return process.env.DATA_DIR ?? './data'
}

function logPath(dataDir: string, storyId: string): string {
  return `${dataDir}/stories/${storyId}/diceroll-log.json`
}

async function readLog(dataDir: string, storyId: string): Promise<LogEntry[]> {
  try {
    const raw = await readFile(logPath(dataDir, storyId), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function appendLog(dataDir: string, storyId: string, entry: LogEntry): Promise<void> {
  if (!isValidStoryId(storyId)) throw new Error('Invalid story id')
  await withLogLock(logPath(dataDir, storyId), async () => {
    const log = await readLog(dataDir, storyId)
    log.push(entry)
    const path = logPath(dataDir, storyId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(log, null, 2))
  })
}

const plugin: WritingPlugin = {
  manifest: {
    name: 'diceroll',
    version: '1.0.0',
    description: 'Dice rolls and yes/no decisions for the LLM',
    panel: { title: 'Diceroll' },
  },

  tools: (dataDir, storyId) => ({
    should: tool({
      description: 'Ask a yes/no/maybe question and get a random answer. Use this to make narrative decisions with an element of chance.',
      inputSchema: z.object({
        question: z.string().describe('The yes/no question to decide'),
      }),
      execute: async ({ question }) => {
        const choices = ['Yes', 'Maybe', 'No'] as const
        const answer = choices[Math.floor(Math.random() * choices.length)]
        await appendLog(dataDir, storyId, {
          type: 'should',
          question,
          answer,
          timestamp: new Date().toISOString(),
        })
        return { question, answer }
      },
    }),
    roll: tool({
      description: 'Roll a random number between min and max (inclusive). Use this when you need a random value for narrative elements.',
      inputSchema: z.object({
        min: z.int().describe('Minimum value (inclusive)'),
        max: z.int().describe('Maximum value (inclusive)'),
        for: z.string().optional().describe('Optional description of what this roll is for'),
      }),
      execute: async ({ min, max, for: purpose }) => {
        if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
          return { error: 'min and max must be integers with min <= max' }
        }
        const result = Math.floor(Math.random() * (max - min + 1)) + min
        await appendLog(dataDir, storyId, {
          type: 'roll',
          min,
          max,
          result,
          for: purpose,
          timestamp: new Date().toISOString(),
        })
        return { min, max, result, for: purpose }
      },
    }),
  }),

  routes: (app) => {
    app.get('/log', async ({ query, set }) => {
      if (!isValidStoryId(query.storyId)) {
        set.status = 400
        return { error: 'Invalid story id' }
      }
      const dataDir = getDataDir()
      const log = await readLog(dataDir, query.storyId)
      return log.slice(-50)
    }, {
      query: t.Object({
        storyId: t.String(),
      }),
    })
    app.delete('/log', async ({ query, set }) => {
      if (!isValidStoryId(query.storyId)) {
        set.status = 400
        return { error: 'Invalid story id' }
      }
      const dataDir = getDataDir()
      const path = logPath(dataDir, query.storyId)
      await withLogLock(path, async () => {
        try {
          await writeFile(path, '[]')
        } catch {
          // file doesn't exist, that's fine
        }
      })
      return { ok: true }
    }, {
      query: t.Object({
        storyId: t.String(),
      }),
    })
    return app
  },
}

export default plugin
