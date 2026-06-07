import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'

/** First non-internal IPv4 address (the LAN address phones can reach), or null. */
export function getLanIp(): string | null {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

export function getLanUrl(port: number, ip: string | null = getLanIp()): string | null {
  return ip ? `http://${ip}:${port}` : null
}

/** Render a URL (or any text) as a PNG data-URL QR code for the UI. */
export function toQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
}

/** The port the local app listens on (Nitro / vite dev). */
export function appPort(): number {
  const p = Number(process.env.PORT)
  return Number.isFinite(p) && p > 0 ? p : 7739
}
