import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { Elysia } from 'elysia'
import { createTempDir } from '../setup'
import plugin from '../../plugins/diceroll/plugin'

let dataDir: string
let cleanup: () => Promise<void>
const prevDataDir = process.env.DATA_DIR

beforeEach(async () => {
  const tmp = await createTempDir()
  dataDir = tmp.path
  cleanup = tmp.cleanup
  process.env.DATA_DIR = dataDir
})
afterEach(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = prevDataDir
  await cleanup()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = (input: any, opts: any) => Promise<any>
function exec(storyId: string, name: 'roll' | 'should'): Exec {
  const tools = plugin.tools!(dataDir, storyId) as unknown as Record<string, { execute: Exec }>
  return tools[name].execute
}

describe('diceroll plugin', () => {
  it('does not lose log entries under concurrent rolls', async () => {
    const roll = exec('story-a', 'roll')
    await Promise.all(Array.from({ length: 25 }, () => roll({ min: 1, max: 6 }, {})))
    const log = JSON.parse(await readFile(join(dataDir, 'stories', 'story-a', 'diceroll-log.json'), 'utf-8'))
    expect(log).toHaveLength(25)
  })

  it('rejects min > max and non-integers without logging', async () => {
    const roll = exec('story-a', 'roll')
    expect(await roll({ min: 10, max: 1 }, {})).toHaveProperty('error')
    expect(await roll({ min: 1.5, max: 6 }, {})).toHaveProperty('error')
    expect(existsSync(join(dataDir, 'stories', 'story-a', 'diceroll-log.json'))).toBe(false)
  })

  it('refuses traversal story ids in tools', async () => {
    await expect(exec('../../evil', 'should')({ question: 'q' }, {})).rejects.toThrow(/Invalid story id/)
  })

  it('log routes reject traversal story ids', async () => {
    const app = plugin.routes!(new Elysia())
    const get = await app.handle(new Request('http://localhost/log?storyId=..%2F..%2Fx'))
    expect(get.status).toBe(400)
    const del = await app.handle(new Request('http://localhost/log?storyId=..%2F..%2Fx', { method: 'DELETE' }))
    expect(del.status).toBe(400)
    const ok = await app.handle(new Request('http://localhost/log?storyId=story-a'))
    expect(ok.status).toBe(200)
  })
})
