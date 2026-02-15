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
  const log = await readLog(dataDir, storyId)
  log.push(entry)
  const path = logPath(dataDir, storyId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(log, null, 2))
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
        min: z.number().describe('Minimum value (inclusive)'),
        max: z.number().describe('Maximum value (inclusive)'),
        for: z.string().optional().describe('Optional description of what this roll is for'),
      }),
      execute: async ({ min, max, for: purpose }) => {
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
    app.get('/log', async ({ query }) => {
      const dataDir = getDataDir()
      const log = await readLog(dataDir, query.storyId)
      return log.slice(-50)
    }, {
      query: t.Object({
        storyId: t.String(),
      }),
    })
    app.delete('/log', async ({ query }) => {
      const dataDir = getDataDir()
      const path = logPath(dataDir, query.storyId)
      try {
        await writeFile(path, '[]')
      } catch {
        // file doesn't exist, that's fine
      }
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
