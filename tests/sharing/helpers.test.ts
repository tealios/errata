import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, parseBasicAuth, checkBasicAuth } from '@/server/sharing/auth'
import { cloudflaredAsset, parseTunnelUrl } from '@/server/sharing/cloudflared'
import { getLanUrl, appPort } from '@/server/sharing/network'

describe('sharing/auth', () => {
  it('hashes and verifies a password (salted, non-reversible)', () => {
    const hash = hashPassword('hunter2')
    expect(hash).toContain(':')
    expect(hash).not.toContain('hunter2')
    expect(verifyPassword('hunter2', hash)).toBe(true)
    expect(verifyPassword('wrong', hash)).toBe(false)
  })

  it('produces a different salt each time', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'))
  })

  it('verifyPassword rejects malformed stored hashes', () => {
    expect(verifyPassword('x', '')).toBe(false)
    expect(verifyPassword('x', 'nocolon')).toBe(false)
    expect(verifyPassword('x', 'salt:')).toBe(false)
  })

  it('parses Basic auth headers', () => {
    const header = 'Basic ' + Buffer.from('alice:s3cret').toString('base64')
    expect(parseBasicAuth(header)).toEqual({ username: 'alice', password: 's3cret' })
    expect(parseBasicAuth('Bearer xyz')).toBeNull()
    expect(parseBasicAuth(undefined)).toBeNull()
    expect(parseBasicAuth('Basic !!!notbase64 with space')).not.toEqual({ username: 'alice', password: 's3cret' })
  })

  it('checkBasicAuth requires matching user AND password', () => {
    const hash = hashPassword('pw')
    const ok = 'Basic ' + Buffer.from('errata:pw').toString('base64')
    const badPw = 'Basic ' + Buffer.from('errata:nope').toString('base64')
    const badUser = 'Basic ' + Buffer.from('mallory:pw').toString('base64')
    expect(checkBasicAuth(ok, 'errata', hash)).toBe(true)
    expect(checkBasicAuth(badPw, 'errata', hash)).toBe(false)
    expect(checkBasicAuth(badUser, 'errata', hash)).toBe(false)
    expect(checkBasicAuth(undefined, 'errata', hash)).toBe(false)
  })
})

describe('sharing/cloudflared', () => {
  it('resolves the right asset per platform', () => {
    expect(cloudflaredAsset('win32', 'x64')).toMatchObject({ binaryName: 'cloudflared.exe', isTgz: false })
    expect(cloudflaredAsset('win32', 'x64').url).toContain('cloudflared-windows-amd64.exe')
    expect(cloudflaredAsset('linux', 'arm64')).toMatchObject({ binaryName: 'cloudflared', isTgz: false })
    expect(cloudflaredAsset('linux', 'arm64').url).toContain('cloudflared-linux-arm64')
    expect(cloudflaredAsset('darwin', 'arm64')).toMatchObject({ binaryName: 'cloudflared', isTgz: true })
    expect(cloudflaredAsset('darwin', 'arm64').url).toContain('cloudflared-darwin-arm64.tgz')
  })

  it('extracts the trycloudflare URL from log output', () => {
    const log = '2024 INF |  https://random-words-here.trycloudflare.com  |'
    expect(parseTunnelUrl(log)).toBe('https://random-words-here.trycloudflare.com')
    expect(parseTunnelUrl('no url here')).toBeNull()
  })
})

describe('sharing/network', () => {
  it('builds a LAN url from an ip + port', () => {
    expect(getLanUrl(7740, '192.168.1.5')).toBe('http://192.168.1.5:7740')
    expect(getLanUrl(7740, null)).toBeNull()
  })

  it('appPort defaults to 7739', () => {
    expect(appPort()).toBe(7739)
  })
})
