import { describe, it, expect } from 'vitest'
import { createTempDir } from './setup'

describe('test setup', () => {
  it('creates and cleans up temp directories', async () => {
    const { path, cleanup } = await createTempDir()
    expect(path).toBeTruthy()

    const { existsSync } = await import('node:fs')
    expect(existsSync(path)).toBe(true)

    await cleanup()
    expect(existsSync(path)).toBe(false)
  })
})
