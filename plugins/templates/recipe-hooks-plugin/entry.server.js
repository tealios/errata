import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { definePlugin } from '@tealios/errata-plugin-sdk'

function logPath(dataDir, storyId) {
  return `${dataDir}/stories/${storyId}/hooks-plugin-log.json`
}

async function appendLog(dataDir, storyId, record) {
  const path = logPath(dataDir, storyId)
  await mkdir(dirname(path), { recursive: true })

  let records = []
  try {
    records = JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    records = []
  }

  records.push(record)
  await writeFile(path, JSON.stringify(records, null, 2))
}

const plugin = definePlugin({
  manifest: {
    name: 'hooks-recipe',
    version: '0.1.0',
    description: 'Demonstrates beforeContext and afterSave hooks',
    panel: { title: 'Hook Log' },
  },

  hooks: {
    async beforeContext(ctx) {
      ctx.messages.push({
        role: 'system',
        content: 'Hook recipe: keep voice consistent and avoid contradictions.',
      })
      return ctx
    },

    async afterSave(fragment, storyId) {
      const dataDir = process.env.DATA_DIR ?? './data'
      await appendLog(dataDir, storyId, {
        fragmentId: fragment.id,
        type: fragment.type,
        timestamp: new Date().toISOString(),
      })
    },
  },
})

export default plugin
