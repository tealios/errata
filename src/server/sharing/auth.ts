import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing + HTTP Basic Auth verification for the sharing proxy.
 * Stored hashes are "salt:hash" (scrypt, hex). All comparisons are timing-safe.
 */

const KEYLEN = 32

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(':')) return false
  const [salt, hashHex] = stored.split(':')
  if (!salt || !hashHex) return false
  let derived: Buffer
  try {
    derived = scryptSync(password, salt, KEYLEN)
  } catch {
    return false
  }
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== derived.length) return false
  return timingSafeEqual(derived, expected)
}

export function parseBasicAuth(header: string | undefined | null): { username: string; password: string } | null {
  if (!header) return null
  const [scheme, encoded] = header.split(' ')
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return null
  let decoded: string
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf-8')
  } catch {
    return null
  }
  const idx = decoded.indexOf(':')
  if (idx === -1) return null
  return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) }
}

function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** True when an Authorization header satisfies the expected credentials. */
export function checkBasicAuth(
  header: string | undefined | null,
  username: string,
  passwordHash: string,
): boolean {
  const creds = parseBasicAuth(header)
  if (!creds) return false
  // Verify both, without short-circuiting, to avoid leaking which one failed.
  const userOk = safeEqualStr(creds.username, username)
  const passOk = verifyPassword(creds.password, passwordHash)
  return userOk && passOk
}
