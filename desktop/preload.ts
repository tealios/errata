/**
 * Preload bridge. Exposes a tiny, typed surface on window.errataDesktop so the renderer
 * can show the app version and drive update checks without Node access. Kept in sync with
 * the renderer-side types in src/lib/desktop.ts.
 */
import { contextBridge, ipcRenderer } from 'electron'

export interface DesktopUpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  error?: string
}

const errataDesktop = {
  isDesktop: true as const,
  getVersion: (): Promise<string> => ipcRenderer.invoke('errata:app:get-version'),
  getUpdateState: (): Promise<DesktopUpdateState> => ipcRenderer.invoke('errata:update:get-state'),
  checkForUpdates: (): Promise<DesktopUpdateState> => ipcRenderer.invoke('errata:update:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('errata:update:install'),
  onUpdateState: (cb: (state: DesktopUpdateState) => void): (() => void) => {
    const listener = (_event: unknown, state: DesktopUpdateState) => cb(state)
    ipcRenderer.on('errata:update:state', listener)
    return () => ipcRenderer.removeListener('errata:update:state', listener)
  },
}

contextBridge.exposeInMainWorld('errataDesktop', errataDesktop)
