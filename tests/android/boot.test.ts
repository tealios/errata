import { describe, expect, it, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

interface BootModule {
  DEFAULT_PORT: number
  installPolyfills: (target?: object) => object
  installRegExpFallback: (target?: object) => boolean
  stripPropertyEscapes: (source: string) => string
  buildServerEnv: (dataRoot: string, port?: number) => Record<string, string>
  serverUrl: (port?: number) => string
  waitForHealth: (opts?: { port?: number; host?: string; timeoutMs?: number; intervalMs?: number }) => Promise<void>
}

const boot = require('../../mobile/node/boot.cjs') as BootModule

/**
 * Mimics V8 built without ICU (Node.js for Mobile Apps): any pattern using a
 * Unicode property escape is rejected at construction time.
 */
function makeNoIcuRegExp(): RegExpConstructor {
  const Native = RegExp
  const NoIcu = function (this: unknown, pattern: string | RegExp, flags?: string) {
    const source = pattern instanceof Native ? pattern.source : String(pattern)
    if (/\\[pP]\{/.test(source)) throw new SyntaxError(`Invalid regular expression: /${source}/: Invalid property name`)
    return new Native(pattern, flags)
  } as unknown as RegExpConstructor
  Object.defineProperty(NoIcu, 'prototype', { value: Native.prototype })
  return NoIcu
}

describe('android boot helpers', () => {
  describe('installPolyfills', () => {
    it('adds Promise.withResolvers and a global crypto when missing', async () => {
      class FakePromise<T> extends Promise<T> {}
      const target: Record<string, unknown> = { Promise: FakePromise, RegExp }
      boot.installPolyfills(target)

      const withResolvers = (
        FakePromise as unknown as {
          withResolvers: () => { promise: Promise<number>; resolve: (v: number) => void }
        }
      ).withResolvers
      expect(typeof withResolvers).toBe('function')
      const { promise, resolve } = withResolvers.call(FakePromise)
      resolve(7)
      await expect(promise).resolves.toBe(7)

      const cryptoLike = target.crypto as { randomUUID: () => string }
      expect(typeof cryptoLike.randomUUID).toBe('function')
    })

    it('leaves existing implementations alone', () => {
      const existing = { withResolvers: () => 'mine' }
      const cryptoSentinel = { randomUUID: () => 'x' }
      const target = { Promise: existing, crypto: cryptoSentinel, RegExp }
      boot.installPolyfills(target)
      expect(target.Promise.withResolvers()).toBe('mine')
      expect(target.crypto).toBe(cryptoSentinel)
      expect(target.RegExp).toBe(RegExp)
    })
  })

  describe('stripPropertyEscapes', () => {
    it('wraps escapes outside a class and inlines them inside one', () => {
      expect(boot.stripPropertyEscapes('^\\p{Emoji}+$')).toBe('^[\\u0080-\\u{10FFFF}]+$')
      expect(boot.stripPropertyEscapes('[\\p{L}_-]')).toBe('[\\u0080-\\u{10FFFF}_-]')
      expect(boot.stripPropertyEscapes('\\P{ASCII}')).toBe('[\\x00-\\x7F]')
    })

    it('leaves escaped backslashes and other escapes untouched', () => {
      expect(boot.stripPropertyEscapes('\\\\p{not}')).toBe('\\\\p{not}')
      expect(boot.stripPropertyEscapes('\\d+\\s*\\[x\\]')).toBe('\\d+\\s*\\[x\\]')
    })
  })

  describe('installRegExpFallback', () => {
    it('is a no-op on a runtime with ICU', () => {
      const target = { RegExp }
      expect(boot.installRegExpFallback(target)).toBe(false)
      expect(target.RegExp).toBe(RegExp)
    })

    it('rescues property-escape patterns on a runtime without ICU', () => {
      const target = { RegExp: makeNoIcuRegExp() }
      expect(boot.installRegExpFallback(target)).toBe(true)

      const emoji = new target.RegExp('^(?:\\p{Emoji}\\uFE0F?)+$', 'u')
      expect(emoji.test('🙂')).toBe(true)
      expect(emoji.test('abc')).toBe(false)
      expect(emoji).toBeInstanceOf(RegExp)

      const word = new target.RegExp('[\\p{Alphabetic}\\p{Number}_]', 'u')
      expect(word.test('_')).toBe(true)
      expect(word.test('é')).toBe(true)

      // Ordinary patterns and ordinary errors pass straight through.
      expect(new target.RegExp('^a+$').test('aaa')).toBe(true)
      expect(() => new target.RegExp('(')).toThrow(SyntaxError)
    })

    it('does not double-wrap when installed twice', () => {
      const target = { RegExp: makeNoIcuRegExp() }
      boot.installRegExpFallback(target)
      const once = target.RegExp
      expect(boot.installRegExpFallback(target)).toBe(false)
      expect(target.RegExp).toBe(once)
    })
  })

  describe('buildServerEnv', () => {
    it('points storage under the app data root and binds to loopback', () => {
      const root = '/data/user/0/com.tealios.errata/files'
      const env = boot.buildServerEnv(root, 7739)
      expect(env.DATA_DIR).toBe(join(root, 'data'))
      expect(env.PLUGIN_DIR).toBe(join(root, 'plugins'))
      expect(env.HOST).toBe('127.0.0.1')
      expect(env.NITRO_HOST).toBe('127.0.0.1')
      expect(env.PORT).toBe('7739')
      expect(env.NITRO_PORT).toBe('7739')
      expect(env.NODE_ENV).toBe('production')
      expect(env.ERRATA_PLATFORM).toBe('android')
    })

    it('rejects a missing data root instead of writing next to the bundle', () => {
      expect(() => boot.buildServerEnv('')).toThrow()
    })
  })

  describe('serverUrl', () => {
    it('is a loopback http URL', () => {
      expect(boot.serverUrl(7739)).toBe('http://127.0.0.1:7739/')
    })
  })

  describe('waitForHealth', () => {
    let server: Server | null = null
    afterEach(async () => {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
      server = null
    })

    it('resolves once /api/health answers 200, tolerating early failures', async () => {
      let calls = 0
      server = createServer((req, res) => {
        calls++
        if (req.url === '/api/health' && calls >= 3) {
          res.writeHead(200).end('{"status":"ok"}')
        } else {
          res.writeHead(503).end()
        }
      })
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as { port: number }).port

      await expect(boot.waitForHealth({ port, timeoutMs: 5_000, intervalMs: 10 })).resolves.toBeUndefined()
      expect(calls).toBeGreaterThanOrEqual(3)
    })

    it('rejects when nothing is listening before the deadline', async () => {
      await expect(boot.waitForHealth({ port: 1, timeoutMs: 200, intervalMs: 20 })).rejects.toThrow(
        /did not become healthy/,
      )
    })
  })
})
