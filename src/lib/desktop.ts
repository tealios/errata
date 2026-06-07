/**
 * Renderer-side access to the Electron desktop bridge (window.errataDesktop, exposed by
 * desktop/preload.ts). Everything degrades to null/no-op in a plain browser, so the same
 * build runs both as the web app and inside the Electron shell.
 */

export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  version?: string
  percent?: number
  error?: string
}

export interface ErrataDesktop {
  isDesktop: true
  getVersion(): Promise<string>
  getUpdateState(): Promise<DesktopUpdateState>
  checkForUpdates(): Promise<DesktopUpdateState>
  installUpdate(): Promise<void>
  /** Subscribe to update-state pushes. Returns an unsubscribe function. */
  onUpdateState(cb: (state: DesktopUpdateState) => void): () => void
}

export const desktop: ErrataDesktop | null =
  typeof window !== 'undefined' && window.errataDesktop ? window.errataDesktop : null

export const isDesktop = desktop !== null
