/**
 * Renderer-side access to the Electron desktop bridge (window.errataDesktop, exposed by
 * desktop/preload.ts). Everything degrades to null/no-op in a plain browser, so the same
 * build runs both as the web app and inside the Electron shell.
 */

export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'skipped'
  | 'not-available'
  | 'error'

export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  version?: string
  releaseName?: string
  releaseDate?: string
  releaseNotes?: string
  percent?: number
  error?: string
}

export interface DesktopUpdatePrefs {
  /** When true, updates download + install automatically without a prompt. */
  autoInstall: boolean
  /** The version the user chose to skip, if any. */
  skippedVersion: string | null
}

export interface ErrataDesktop {
  isDesktop: true
  getVersion(): Promise<string>
  getUpdateState(): Promise<DesktopUpdateState>
  getUpdatePrefs(): Promise<DesktopUpdatePrefs>
  /** Toggle silent auto-update. Returns the updated prefs. */
  setAutoInstall(enabled: boolean): Promise<DesktopUpdatePrefs>
  checkForUpdates(): Promise<DesktopUpdateState>
  /** Start downloading the available update (also used to download a skipped version). */
  downloadUpdate(): Promise<void>
  /** Skip a specific version; it can still be downloaded later. Returns updated prefs. */
  skipUpdate(version: string): Promise<DesktopUpdatePrefs>
  /** Back up stories, then quit and install the downloaded update. */
  installUpdate(): Promise<void>
  /** Subscribe to update-state pushes. Returns an unsubscribe function. */
  onUpdateState(cb: (state: DesktopUpdateState) => void): () => void
}

export function getDesktopBridge(): ErrataDesktop | null {
  return typeof window !== 'undefined' && window.errataDesktop ? window.errataDesktop : null
}

export function onDesktopBridgeReady(
  cb: (bridge: ErrataDesktop) => void,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): () => void {
  const bridge = getDesktopBridge()
  if (bridge) {
    cb(bridge)
    return () => {}
  }

  if (typeof window === 'undefined') return () => {}

  const timeoutMs = options.timeoutMs ?? 1500
  const intervalMs = options.intervalMs ?? 50
  const startedAt = Date.now()
  let disposed = false
  // window.setTimeout returns a number in the browser; typing it as ReturnType<...> picks up
  // the Node Timeout overload from @types/node and mismatches the value at the call site.
  let timer: number | undefined

  const poll = () => {
    if (disposed) return

    const nextBridge = getDesktopBridge()
    if (nextBridge) {
      cb(nextBridge)
      return
    }

    if (Date.now() - startedAt >= timeoutMs) return
    timer = window.setTimeout(poll, intervalMs)
  }

  timer = window.setTimeout(poll, intervalMs)

  return () => {
    disposed = true
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

export const desktop: ErrataDesktop | null = getDesktopBridge()

export const isDesktop = desktop !== null
