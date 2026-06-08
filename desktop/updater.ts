/**
 * Auto-update wiring around electron-updater.
 *
 * Updates are fully user-initiated: Errata only checks when the renderer asks, nothing
 * downloads automatically, and installation only happens after the user confirms it.
 *
 * Before any update is applied, the stories/data directory is copied to userData/backups.
 *
 * No-ops in development (app.isPackaged === false), where there is no feed.
 */
import { app, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { errataDataDir } from './sidecar'

const { autoUpdater } = electronUpdater

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'skipped'
  | 'not-available'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  percent?: number
  error?: string
}

export interface UpdatePrefs {
  /** Deprecated. Kept in the bridge shape for compatibility with older renderer builds. */
  autoInstall: boolean
  /** A version the user chose to skip; not prompted again until something newer appears. */
  skippedVersion: string | null
}

const MAX_BACKUPS = 5

let state: UpdateState = { status: 'idle' }
let prefs: UpdatePrefs = { autoInstall: false, skippedVersion: null }
let targetWindow: BrowserWindow | null = null
let wired = false
let applying = false

const prefsPath = () => join(app.getPath('userData'), 'update-prefs.json')

async function loadPrefs() {
  try {
    const parsed = JSON.parse(await readFile(prefsPath(), 'utf-8'))
    prefs = {
      autoInstall: false,
      skippedVersion: typeof parsed.skippedVersion === 'string' ? parsed.skippedVersion : null,
    }
  } catch {
    /* no prefs yet: keep defaults */
  }
}

async function savePrefs() {
  try {
    await writeFile(prefsPath(), JSON.stringify(prefs, null, 2))
  } catch {
    /* non-fatal */
  }
}

function broadcast() {
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('errata:update:state', state)
  }
}

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  broadcast()
}

function startDownload() {
  setState({ status: 'downloading', percent: 0, error: undefined })
  autoUpdater.downloadUpdate().catch((err) => {
    setState({ status: 'error', error: err instanceof Error ? err.message : String(err) })
  })
}

/** Copy the stories/data directory into userData/backups before an update is applied. */
async function backupStories() {
  const dataDir = errataDataDir()
  if (!existsSync(dataDir)) return
  const backupsRoot = join(app.getPath('userData'), 'backups')
  await mkdir(backupsRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await cp(dataDir, join(backupsRoot, `data-v${app.getVersion()}-${stamp}`), { recursive: true })

  // Keep only the most recent MAX_BACKUPS (names are timestamp-sortable).
  try {
    const dirs = (await readdir(backupsRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    for (const name of dirs.slice(0, Math.max(0, dirs.length - MAX_BACKUPS))) {
      await rm(join(backupsRoot, name), { recursive: true, force: true })
    }
  } catch {
    /* pruning is best-effort */
  }
}

/** Back up, then quit and install. Used by both the manual install and auto-install paths. */
async function applyUpdate() {
  if (applying) return
  applying = true
  try {
    await backupStories()
  } catch {
    /* a failed backup should not block a user-requested update */
  }
  autoUpdater.quitAndInstall()
}

function wireUpdaterEvents() {
  // We drive download + install ourselves so we can gate on confirmation and back up first.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: undefined }))
  autoUpdater.on('update-available', (info) => {
    const version = info.version
    if (version === prefs.skippedVersion) {
      setState({ status: 'skipped', version })
    } else {
      setState({ status: 'available', version })
    }
  })
  autoUpdater.on('update-not-available', () => setState({ status: 'not-available' }))
  autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => setState({ status: 'error', error: err?.message ?? String(err) }))
}

export function setupUpdater(window: BrowserWindow) {
  targetWindow = window
  if (wired) return
  wired = true

  // IPC is always registered (dev included) so the renderer's calls resolve.
  ipcMain.handle('errata:app:get-version', () => app.getVersion())
  ipcMain.handle('errata:update:get-state', () => state)
  ipcMain.handle('errata:update:get-prefs', () => prefs)

  ipcMain.handle('errata:update:set-auto-install', () => {
    prefs.autoInstall = false
    void savePrefs()
    return prefs
  })

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

  // Confirm a download (also used to download a previously-skipped version).
  ipcMain.handle('errata:update:download', () => {
    prefs.skippedVersion = null
    void savePrefs()
    if (app.isPackaged) startDownload()
  })

  ipcMain.handle('errata:update:skip', (_e, version?: string) => {
    prefs.skippedVersion = version ?? state.version ?? null
    void savePrefs()
    setState({ status: 'skipped', version: prefs.skippedVersion ?? undefined })
    return prefs
  })

  ipcMain.handle('errata:update:install', () => {
    void applyUpdate()
  })

  if (!app.isPackaged) return

  void loadPrefs().then(() => {
    wireUpdaterEvents()
  })
}
