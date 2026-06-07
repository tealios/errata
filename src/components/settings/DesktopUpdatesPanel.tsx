/**
 * Desktop-only "App & Updates" controls. Renders nothing in the browser build. Inside the
 * Electron shell it shows the installed version and drives electron-updater: a manual check,
 * background download progress, and a restart-to-install action. Update state is pushed from
 * the main process (see desktop/updater.ts) via the preload bridge.
 *
 * No em dashes in copy, per project convention.
 */
import { useEffect, useState } from 'react'
import { RefreshCw, Download } from 'lucide-react'
import { desktop, type DesktopUpdateState } from '@/lib/desktop'
import { SectionHeading, SettingsCard, SettingRow } from './primitives'

function statusText(state: DesktopUpdateState): string {
  switch (state.status) {
    case 'checking':
      return 'Checking for updates...'
    case 'available':
    case 'downloading':
      return `Downloading update ${state.percent ?? 0}%`
    case 'downloaded':
      return `Version ${state.version ?? ''} is ready. Restart to install.`
    case 'not-available':
      return 'You are on the latest version.'
    case 'error':
      return `Update check failed: ${state.error ?? 'unknown error'}`
    default:
      return 'Updates are checked automatically on launch.'
  }
}

export function DesktopUpdatesControls() {
  const [version, setVersion] = useState<string | null>(null)
  const [state, setState] = useState<DesktopUpdateState>({ status: 'idle' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!desktop) return
    desktop.getVersion().then(setVersion).catch(() => {})
    desktop.getUpdateState().then(setState).catch(() => {})
    return desktop.onUpdateState(setState)
  }, [])

  if (!desktop) return null
  const bridge = desktop

  const checking = busy || state.status === 'checking' || state.status === 'downloading'
  const ready = state.status === 'downloaded'

  const check = async () => {
    setBusy(true)
    try {
      setState(await bridge.checkForUpdates())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <SectionHeading label="Desktop app" />
      <SettingsCard>
        <SettingRow label="Version">
          <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
            v{version ?? __BUILD_VERSION__}
          </span>
        </SettingRow>
        <SettingRow label="Updates" description={statusText(state)}>
          {ready ? (
            <button
              type="button"
              onClick={() => bridge.installUpdate()}
              className="flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[0.6875rem] font-medium text-background transition-opacity hover:opacity-90"
            >
              <Download className="size-3" />
              Restart and install
            </button>
          ) : (
            <button
              type="button"
              onClick={check}
              disabled={checking}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground/70 disabled:opacity-40"
            >
              <RefreshCw className={`size-3 ${checking ? 'animate-spin' : ''}`} />
              Check for updates
            </button>
          )}
        </SettingRow>
      </SettingsCard>
    </div>
  )
}
