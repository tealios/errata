import { writeFile, rename } from 'node:fs/promises'

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmpPath = `${path}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
  await rename(tmpPath, path)
}
