import type { ErrataDesktop } from '@/lib/desktop'

declare global {
  const __BUILD_VERSION__: string

  interface Window {
    /** Present only inside the Electron desktop shell (see electron/preload.ts). */
    errataDesktop?: ErrataDesktop
  }
}

export {}
