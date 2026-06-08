/**
 * Desktop-only Updates controls. Renders nothing in the browser build. Inside the Electron
 * shell it drives electron-updater: a manual check, confirm-to-download (or skip), download
 * progress, and restart-to-install. Updates are never checked, downloaded, or installed until
 * the user asks. Stories are backed up before any update is applied. Update state is pushed
 * from the main process (see desktop/updater.ts) via the preload bridge.
 *
 * No em dashes in copy, per project convention.
 */
import { useEffect, useState } from 'react'
import { RefreshCw, Download } from 'lucide-react'
import { getDesktopBridge, onDesktopBridgeReady, type DesktopUpdateState, type ErrataDesktop } from '@/lib/desktop'
import { SectionHeading, SettingsCard, SettingRow } from './primitives'

const primaryBtn =
  'flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[0.6875rem] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40'
const ghostBtn =
  'flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground/70 disabled:opacity-40'

function statusText(state: DesktopUpdateState): string {
  switch (state.status) {
    case 'checking':
      return 'Checking for updates...'
    case 'available':
      return `Version ${state.version ?? ''} is available.`
    case 'downloading':
      return `Downloading ${state.version ?? 'update'}... ${state.percent ?? 0}%`
    case 'downloaded':
      return `Version ${state.version ?? ''} is ready to install.`
    case 'skipped':
      return `Version ${state.version ?? ''} skipped.`
    case 'not-available':
      return 'You are on the latest version.'
    case 'error':
      return `Update check failed: ${state.error ?? 'unknown error'}`
    default:
      return 'Check manually when you want to look for a new release.'
  }
}

export function DesktopUpdatesControls() {
  const [bridge, setBridge] = useState<ErrataDesktop | null>(() => getDesktopBridge())
  const [state, setState] = useState<DesktopUpdateState>({ status: 'idle' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let unsubscribeUpdates: (() => void) | undefined
    const stopWaiting = onDesktopBridgeReady((currentBridge) => {
      setBridge(currentBridge)
      currentBridge.getUpdateState().then(setState).catch(() => {})
      unsubscribeUpdates = currentBridge.onUpdateState(setState)
    })
    return () => {
      stopWaiting()
      unsubscribeUpdates?.()
    }
  }, [])

  if (!bridge) return null

  const check = async () => {
    setBusy(true)
    try {
      setState(await bridge.checkForUpdates())
    } finally {
      setBusy(false)
    }
  }

  const checking = busy || state.status === 'checking'
  const checkButton = (
    <button type="button" className={ghostBtn} onClick={check} disabled={checking}>
      <RefreshCw className={`size-3 ${checking ? 'animate-spin' : ''}`} />
      Check for updates
    </button>
  )

  const actions = () => {
    switch (state.status) {
      case 'available':
        return (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button type="button" className={primaryBtn} onClick={() => bridge.downloadUpdate()}>
              <Download className="size-3" />
              Download and install
            </button>
            <button type="button" className={ghostBtn} onClick={() => bridge.skipUpdate(state.version ?? '')}>
              Skip
            </button>
            {checkButton}
          </div>
        )
      case 'skipped':
        return (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button type="button" className={ghostBtn} onClick={() => bridge.downloadUpdate()}>
              <Download className="size-3" />
              Download
            </button>
            {checkButton}
          </div>
        )
      case 'downloaded':
        return (
          <button type="button" className={primaryBtn} onClick={() => bridge.installUpdate()}>
            <Download className="size-3" />
            Restart and install
          </button>
        )
      case 'downloading':
      case 'checking':
        return null
      default:
        return checkButton
    }
  }

  return (
    <div>
      <SectionHeading label="Updates" />
      <SettingsCard>
        <SettingRow label="Desktop updates" description={statusText(state)}>
          {actions()}
        </SettingRow>
      </SettingsCard>
      <p className="mt-1.5 px-3 text-[0.625rem] leading-snug text-muted-foreground">
        Errata only checks for updates when you click the button. Your stories are backed up before every install.
      </p>
    </div>
  )
}
