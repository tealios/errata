/**
 * Auto-update wiring around electron-updater. Checks GitHub Releases on launch, downloads
 * in the background, and applies on quit (autoInstallOnAppQuit). Update state is mirrored
 * to the renderer over IPC so Settings can show progress and a manual check / install.
 *
 * No-ops in development (app.isPackaged === false), where there is no feed.
 */
import { app, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  percent?: number
  error?: string
}

let state: UpdateState = { status: 'idle' }
let targetWindow: BrowserWindow | null = null
let wired = false

function broadcast() {
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('errata:update:state', state)
  }
}

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  broadcast()
}

function wireUpdaterEvents() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: undefined }))
  autoUpdater.on('update-available', (info) =>
    setState({ status: 'downloading', version: info.version, percent: 0 }),
  )
  autoUpdater.on('update-not-available', () => setState({ status: 'not-available' }))
  autoUpdater.on('download-progress', (progress) =>
    setState({ status: 'downloading', percent: Math.round(progress.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) =>
    setState({ status: 'downloaded', version: info.version, percent: 100 }),
  )
  autoUpdater.on('error', (err) =>
    setState({ status: 'error', error: err?.message ?? String(err) }),
  )
}

export function setupUpdater(window: BrowserWindow) {
  targetWindow = window

  // IPC is registered once for the app lifetime; later windows just re-point the target.
  if (!wired) {
    wired = true

    ipcMain.handle('errata:app:get-version', () => app.getVersion())
    ipcMain.handle('errata:update:get-state', () => state)

    ipcMain.handle('errata:update:check', async () => {
      if (!app.isPackaged) {
        setState({ status: 'not-available' })
        return state
      }
      try {
        setState({ status: 'checking', error: undefined })
        await autoUpdater.checkForUpdates()
      } catch (err) {
        setState({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
      return state
    })

    ipcMain.handle('errata:update:install', () => {
      if (state.status === 'downloaded') autoUpdater.quitAndInstall()
    })

    if (app.isPackaged) {
      wireUpdaterEvents()
      // Give the window a beat to load before the first network check.
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => {
          /* surfaced via the error event */
        })
      }, 3_000)
    }
  }
}
