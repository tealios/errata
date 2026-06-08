import { afterEach, describe, expect, it, vi } from 'vitest'
import { onDesktopBridgeReady, type ErrataDesktop } from '../../src/lib/desktop'

function makeBridge(): ErrataDesktop {
  return {
    isDesktop: true,
    getVersion: async () => '1.0.0',
    getUpdateState: async () => ({ status: 'idle' }),
    getUpdatePrefs: async () => ({ autoInstall: false, skippedVersion: null }),
    setAutoInstall: async () => ({ autoInstall: false, skippedVersion: null }),
    checkForUpdates: async () => ({ status: 'not-available' }),
    downloadUpdate: async () => {},
    skipUpdate: async () => ({ autoInstall: false, skippedVersion: null }),
    installUpdate: async () => {},
    onUpdateState: () => () => {},
  }
}

describe('desktop bridge access', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('calls back when the Electron preload bridge appears after mount', async () => {
    vi.useFakeTimers()
    const windowStub = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      errataDesktop: undefined as ErrataDesktop | undefined,
    }
    vi.stubGlobal('window', windowStub)

    const cb = vi.fn()
    const stop = onDesktopBridgeReady(cb, { timeoutMs: 100, intervalMs: 10 })
    await vi.advanceTimersByTimeAsync(20)
    expect(cb).not.toHaveBeenCalled()

    const bridge = makeBridge()
    windowStub.errataDesktop = bridge
    await vi.advanceTimersByTimeAsync(10)

    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith(bridge)
    stop()
  })

  it('stops polling when disposed', async () => {
    vi.useFakeTimers()
    const windowStub = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      errataDesktop: undefined as ErrataDesktop | undefined,
    }
    vi.stubGlobal('window', windowStub)

    const cb = vi.fn()
    const stop = onDesktopBridgeReady(cb, { timeoutMs: 100, intervalMs: 10 })
    stop()
    windowStub.errataDesktop = makeBridge()
    await vi.advanceTimersByTimeAsync(100)

    expect(cb).not.toHaveBeenCalled()
  })
})
