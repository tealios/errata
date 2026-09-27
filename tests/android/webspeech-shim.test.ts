import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

/**
 * mobile/shell/webspeech-shim.js is injected by the Android shell (MainActivity) at
 * document start. The Android System WebView ships no Web Speech API, so the shim
 * implements `speechSynthesis` / `SpeechSynthesisUtterance` on top of a native
 * `ErrataNativeTts` JS interface backed by android.speech.tts.TextToSpeech.
 */
const SHIM = readFileSync(join(__dirname, '../../mobile/shell/webspeech-shim.js'), 'utf8')

interface SpokenCall { id: string; text: string; voice: string; rate: number; pitch: number; volume: number }

function makeNative(voices: object[] = []) {
  const calls: SpokenCall[] = []
  let cancels = 0
  return {
    calls,
    get cancels() { return cancels },
    bridge: {
      getVoices: () => JSON.stringify(voices),
      speak: (id: string, text: string, voice: string, rate: number, pitch: number, volume: number) => {
        calls.push({ id, text, voice, rate, pitch, volume })
      },
      cancel: () => { cancels++ },
    },
  }
}

type Win = Record<string, any>

function install(win: Win) {
  vm.runInNewContext(SHIM, { window: win, EventTarget, Event, JSON, String, Number, Array, Object, Math, Intl })
  return win
}

describe('webspeech shim', () => {
  let native: ReturnType<typeof makeNative>
  let win: Win

  beforeEach(() => {
    native = makeNative([
      { name: 'en-us-x-sfg-local', lang: 'en-US', local: true, default: true },
      { name: 'en-gb-x-rjs-network', lang: 'en-GB', local: false, default: false },
    ])
    win = install({ ErrataNativeTts: native.bridge })
  })

  it('does nothing without the native bridge', () => {
    const bare = install({})
    expect(bare.speechSynthesis).toBeUndefined()
    expect(bare.SpeechSynthesisUtterance).toBeUndefined()
  })

  it('leaves a real speechSynthesis alone', () => {
    const real = { speak() {} }
    const w = install({ ErrataNativeTts: native.bridge, speechSynthesis: real })
    expect(w.speechSynthesis).toBe(real)
  })

  it('exposes native voices in Web Speech shape', () => {
    const voices = win.speechSynthesis.getVoices()
    expect(voices).toHaveLength(2)
    expect(voices[0]).toMatchObject({ voiceURI: 'en-us-x-sfg-local', lang: 'en-US', localService: true, default: true })
    expect(voices[1]).toMatchObject({ voiceURI: 'en-gb-x-rjs-network', localService: false })
  })

  it('gives Android voices readable names', () => {
    const w = install({
      ErrataNativeTts: makeNative([
        { name: 'en-GB-language', lang: 'en-GB', local: true },
        { name: 'en-gb-x-gba-local', lang: 'en-GB', local: true },
        { name: 'en-gb-x-rjs-network', lang: 'en-GB', local: false },
        { name: 'weird', lang: '', local: true },
      ]).bridge,
      navigator: { language: 'en-US' },
    })
    expect(w.speechSynthesis.getVoices().map((v: any) => v.name)).toEqual([
      'British English',
      'British English · gba',
      'British English · rjs (online)',
      'weird',
    ])
  })

  it('speaks one utterance at a time and fires start/end', () => {
    const events: string[] = []
    const a = new win.SpeechSynthesisUtterance('First.')
    a.rate = 1.5
    a.pitch = 0.8
    a.volume = 0.5
    a.voice = win.speechSynthesis.getVoices()[1]
    a.onstart = () => events.push('a:start')
    a.onend = () => events.push('a:end')
    const b = new win.SpeechSynthesisUtterance('Second.')
    b.addEventListener('end', () => events.push('b:end'))

    win.speechSynthesis.speak(a)
    win.speechSynthesis.speak(b)
    expect(native.calls).toHaveLength(1)
    expect(native.calls[0]).toMatchObject({ text: 'First.', voice: 'en-gb-x-rjs-network', rate: 1.5, pitch: 0.8, volume: 0.5 })
    expect(win.speechSynthesis.speaking).toBe(true)
    expect(win.speechSynthesis.pending).toBe(true)

    win.__errataSpeech._native('start', native.calls[0].id)
    win.__errataSpeech._native('end', native.calls[0].id)
    expect(native.calls).toHaveLength(2)
    expect(native.calls[1]).toMatchObject({ text: 'Second.', voice: '' })

    win.__errataSpeech._native('end', native.calls[1].id)
    expect(events).toEqual(['a:start', 'a:end', 'b:end'])
    expect(win.speechSynthesis.speaking).toBe(false)
  })

  it('reports native errors and moves on', () => {
    const errors: string[] = []
    const a = new win.SpeechSynthesisUtterance('Bad.')
    a.onerror = (e: any) => errors.push(e.error)
    win.speechSynthesis.speak(a)
    win.speechSynthesis.speak(new win.SpeechSynthesisUtterance('Next.'))
    win.__errataSpeech._native('error', native.calls[0].id)
    expect(errors).toEqual(['synthesis-failed'])
    expect(native.calls.map((c) => c.text)).toEqual(['Bad.', 'Next.'])
  })

  it('cancel clears the queue, stops native audio and ignores late events', () => {
    const ended: string[] = []
    const a = new win.SpeechSynthesisUtterance('One.')
    a.onend = () => ended.push('a')
    win.speechSynthesis.speak(a)
    win.speechSynthesis.speak(new win.SpeechSynthesisUtterance('Two.'))
    win.speechSynthesis.cancel()
    expect(native.cancels).toBe(1)
    expect(win.speechSynthesis.speaking).toBe(false)
    expect(win.speechSynthesis.pending).toBe(false)
    win.__errataSpeech._native('end', native.calls[0].id) // native stop callback arrives late
    expect(ended).toEqual([])
    expect(native.calls).toHaveLength(1)
  })

  it('pause stops audio; resume restarts the interrupted utterance', () => {
    const a = new win.SpeechSynthesisUtterance('Sentence.')
    const ended: string[] = []
    a.onend = () => ended.push('a')
    win.speechSynthesis.speak(a)
    win.speechSynthesis.pause()
    expect(win.speechSynthesis.paused).toBe(true)
    expect(native.cancels).toBe(1)
    win.__errataSpeech._native('end', native.calls[0].id) // stop callback for the paused speech
    expect(ended).toEqual([])

    win.speechSynthesis.resume()
    expect(win.speechSynthesis.paused).toBe(false)
    expect(native.calls).toHaveLength(2)
    expect(native.calls[1].text).toBe('Sentence.')
    win.__errataSpeech._native('end', native.calls[1].id)
    expect(ended).toEqual(['a'])
  })

  it('fires voiceschanged when the native engine finishes loading', () => {
    let fired = 0
    win.speechSynthesis.addEventListener('voiceschanged', () => fired++)
    win.speechSynthesis.onvoiceschanged = () => fired++
    win.__errataSpeech._native('voices', '')
    expect(fired).toBe(2)
  })
})
