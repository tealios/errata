/**
 * Text-to-speech for reading prose aloud. Two engines:
 *  - 'browser' — the Web Speech API (SpeechSynthesisUtterance). Instant, no download.
 *  - 'supertonic' — Supertonic neural voices via Transformers.js (onnx-community/
 *               Supertonic-TTS-ONNX), running in a Web Worker on WebGPU (WASM
 *               fallback). Downloads the model (~200 MB) on first use, cached by
 *               the browser. The worker is created only when the engine is used.
 *
 * Playback is CHUNKED: the passage is split into sentence-sized pieces and
 * synthesized one at a time, so audio starts after the first sentence is ready
 * instead of after the whole passage. While a chunk plays, the next is already
 * being synthesized (prefetch), so playback stays ahead of generation.
 *
 * The whole feature is OPT-IN: `enabled` defaults to false, so the read-aloud
 * control and any model download only appear after the user turns it on.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

// ---------------------------------------------------------------------------
// Settings (client-side, persisted in localStorage — a per-device preference)
// ---------------------------------------------------------------------------

export type TtsEngine = 'browser' | 'supertonic'

export interface TtsSettings {
  /** Master opt-in. When false, no read-aloud UI is shown and no models download. */
  enabled: boolean
  engine: TtsEngine
  /** Web Speech voice (voiceURI), or null for the browser default. */
  browserVoiceURI: string | null
  /** Supertonic voice id, e.g. 'F1' or 'M1'. */
  supertonicVoiceId: string
  /** Supertonic denoising steps (num_inference_steps): higher = better, slower. */
  steps: number
  /** 0.5–2. Speech speed (utterance rate / Supertonic speed). */
  rate: number
  /** 0–2. Browser engine only. */
  pitch: number
  /** 0–1. */
  volume: number
}

export const TTS_DEFAULTS: TtsSettings = {
  enabled: false,
  engine: 'browser',
  browserVoiceURI: null,
  supertonicVoiceId: 'F1',
  steps: 5,
  rate: 1,
  pitch: 1,
  volume: 1,
}

const TTS_KEY = 'errata-tts-settings'
const TTS_EVENT = 'errata-tts-settings-change'

export function getTtsSettings(): TtsSettings {
  if (typeof window === 'undefined') return TTS_DEFAULTS
  try {
    const raw = localStorage.getItem(TTS_KEY)
    if (!raw) return TTS_DEFAULTS
    const stored = JSON.parse(raw) as Partial<TtsSettings>
    // Migrate the old Piper engine id to Supertonic; drop anything unknown.
    const eng = (stored as { engine?: string }).engine
    if (eng === 'piper') stored.engine = 'supertonic'
    else if (eng !== 'browser' && eng !== 'supertonic') delete stored.engine
    return { ...TTS_DEFAULTS, ...stored }
  } catch {
    return TTS_DEFAULTS
  }
}

export function useTtsSettings(): [TtsSettings, (patch: Partial<TtsSettings>) => void] {
  const [value, setValue] = useState<TtsSettings>(getTtsSettings)

  useEffect(() => {
    const handler = (e: Event) => setValue((e as CustomEvent<TtsSettings>).detail)
    window.addEventListener(TTS_EVENT, handler)
    return () => window.removeEventListener(TTS_EVENT, handler)
  }, [])

  const update = useCallback((patch: Partial<TtsSettings>) => {
    setValue((prev) => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem(TTS_KEY, JSON.stringify(next)) } catch { /* ignore quota */ }
      window.dispatchEvent(new CustomEvent(TTS_EVENT, { detail: next }))
      return next
    })
  }, [])

  return [value, update]
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

export interface SupertonicVoiceOption {
  id: string
  label: string
}

/** Supertonic preset voices (speaker-embedding .bin files on the Hub). */
export const SUPERTONIC_VOICES: SupertonicVoiceOption[] = [
  { id: 'F1', label: 'Female 1' },
  { id: 'F2', label: 'Female 2' },
  { id: 'F3', label: 'Female 3' },
  { id: 'F4', label: 'Female 4' },
  { id: 'F5', label: 'Female 5' },
  { id: 'M1', label: 'Male 1' },
  { id: 'M2', label: 'Male 2' },
  { id: 'M3', label: 'Male 3' },
  { id: 'M4', label: 'Male 4' },
  { id: 'M5', label: 'Male 5' },
]

export function isBrowserTtsSupported(): boolean {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof SpeechSynthesisUtterance !== 'undefined'
}

export function getBrowserVoices(): SpeechSynthesisVoice[] {
  if (!isBrowserTtsSupported()) return []
  return window.speechSynthesis.getVoices()
}

/** Browser voices load asynchronously; this keeps a fresh list for the UI. */
export function useBrowserVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(getBrowserVoices)
  useEffect(() => {
    if (!isBrowserTtsSupported()) return
    const update = () => setVoices(window.speechSynthesis.getVoices())
    update()
    window.speechSynthesis.addEventListener('voiceschanged', update)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update)
  }, [])
  return voices
}

// ---------------------------------------------------------------------------
// Markdown → speakable plain text, then sentence chunks
// ---------------------------------------------------------------------------

export function toPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')              // fenced code
    .replace(/`([^`]+)`/g, '$1')                  // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')        // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')      // links → label
    .replace(/^#{1,6}\s+/gm, '')                  // headings
    .replace(/^\s{0,3}>\s?/gm, '')                // blockquotes
    .replace(/^\s*[-*+]\s+/gm, '')                // list bullets
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')          // horizontal rules
    .replace(/(\*\*\*|\*\*|\*|___|__|_|~~)/g, '') // emphasis markers
    // Normalize typography to ASCII the phonemizer handles reliably, and drop
    // symbols/emoji that have no spoken form (and can crash neural synthesis
    // with out-of-range phoneme ids).
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—―]/g, ' - ')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/gu, '')
    .replace(/\r\n/g, '\n')
    .replace(/([.!?…])[ \t]*\n{2,}[ \t]*/g, '$1 ') // para break after end-punctuation: keep it
    .replace(/\n{2,}/g, '. ')                       // other para breaks → spoken pause
    .replace(/\n/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/**
 * Split plain text into speakable chunks: greedily merge whole sentences up to
 * `max` chars so each chunk is a natural unit, hard-splitting any runaway
 * sentence on whitespace so a chunk never blocks the queue for too long.
 */
export function chunkText(text: string, { max = 240 }: { max?: number } = {}): string[] {
  const sentences = text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean)
  const chunks: string[] = []
  let buf = ''

  const flushLong = (s: string) => {
    // sentence longer than max with no boundary — split on word gaps
    const words = s.split(/\s+/)
    let part = ''
    for (const w of words) {
      if (part && (part + ' ' + w).length > max) { chunks.push(part); part = w }
      else part = part ? `${part} ${w}` : w
    }
    if (part) buf = part
  }

  for (const s of sentences) {
    if (s.length > max) {
      if (buf) { chunks.push(buf); buf = '' }
      flushLong(s)
    } else if (!buf) {
      buf = s
    } else if ((buf + ' ' + s).length <= max) {
      buf += ' ' + s
    } else {
      chunks.push(buf)
      buf = s
    }
  }
  if (buf) chunks.push(buf)
  return chunks
}

// ---------------------------------------------------------------------------
// Playback controller — a small external store the player bar + prose blocks
// subscribe to. Chunks are synthesized one ahead of playback.
// ---------------------------------------------------------------------------

export type TtsStatus = 'idle' | 'loading' | 'playing' | 'paused'

export interface TtsState {
  status: TtsStatus
  /** Fragment id currently being read. */
  activeId: string | null
  /** Short label shown in the player. */
  title: string | null
  /** 0-based index of the chunk currently playing. */
  chunkIndex: number
  chunkCount: number
  engine: TtsEngine | null
  error: string | null
}

const IDLE: TtsState = { status: 'idle', activeId: null, title: null, chunkIndex: 0, chunkCount: 0, engine: null, error: null }

let state: TtsState = IDLE
const listeners = new Set<() => void>()

function emit(patch: Partial<TtsState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useTtsState(): TtsState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => state,
    () => IDLE,
  )
}

/**
 * Whether `id` is the fragment currently being read. Returns a boolean snapshot
 * so a prose block only re-renders when its own reading status flips — not on
 * every chunk advance.
 */
export function useIsReadingFragment(id: string): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => state.activeId === id,
    () => false,
  )
}

/** A natural breath inserted between chunks so sentences don't run together. */
const INTER_CHUNK_PAUSE_MS = 280

function ttsLog(message: string): void {
  // eslint-disable-next-line no-console
  console.info(`[tts] ${message}`)
}

interface Session {
  id: string
  chunks: string[]
  settings: TtsSettings
  token: number
  blobs: Map<number, Promise<Blob>>
  /** Indices whose audio has finished synthesizing (pre-generated, ready to play). */
  ready: Set<number>
  /** Whether at least one chunk has actually played (to detect total failure). */
  played: boolean
  audio: HTMLAudioElement | null
}

let session: Session | null = null
let token = 0

// --- Neural worker: Supertonic synthesis runs off the main thread so the UI
// never freezes, and the model stays warm across chunks. ---

let neuralWorker: Worker | null = null
let reqId = 0
const pending = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>()

function getNeuralWorker(): Worker {
  if (neuralWorker) return neuralWorker
  const worker = new Worker(new URL('./supertonic.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent) => {
    const { id, ok, buf, mime, error } = e.data as { id: number; ok: boolean; buf?: ArrayBuffer; mime?: string; error?: string }
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (ok && buf) p.resolve(new Blob([buf], { type: mime || 'audio/wav' }))
    else p.reject(new Error(error || 'Speech synthesis failed'))
  }
  worker.onerror = () => {
    for (const p of pending.values()) p.reject(new Error('The speech engine crashed.'))
    pending.clear()
    neuralWorker?.terminate()
    neuralWorker = null
  }
  neuralWorker = worker
  return worker
}

function synthChunk(s: TtsSettings, text: string): Promise<Blob> {
  const worker = getNeuralWorker()
  const id = ++reqId
  return new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage({ id, type: 'synth', voiceId: s.supertonicVoiceId, text, steps: s.steps, speed: s.rate })
  })
}

/** Warm the neural pipeline (downloads + caches the model). Resolves when ready. */
export function preloadNeural(settings: TtsSettings): Promise<Blob> {
  return synthChunk(settings, 'Ready.')
}

function alive(t: number): boolean {
  return session !== null && session.token === t && token === t
}

function reset() {
  if (session?.audio) {
    session.audio.pause()
    if (session.audio.src) URL.revokeObjectURL(session.audio.src)
  }
  session = null
}

export function stopTts(): void {
  token++ // invalidate any in-flight synthesis / queued chunk
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
  reset()
  emit(IDLE)
}

export function pauseTts(): void {
  if (!session) return
  if (session.settings.engine === 'browser') {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.pause()
  } else {
    session.audio?.pause()
  }
  emit({ status: 'paused' })
}

export function resumeTts(): void {
  if (!session) return
  if (session.settings.engine === 'browser') {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.resume()
  } else {
    void session.audio?.play()
  }
  emit({ status: 'playing' })
}

export function togglePlayPause(): void {
  if (state.status === 'playing') pauseTts()
  else if (state.status === 'paused') resumeTts()
}

/**
 * Adjust playback volume live. Updates the playing audio immediately (Supertonic) and
 * the active session so subsequent chunks use it too. Persisting the preference
 * is the caller's job (via useTtsSettings).
 */
export function setTtsVolume(v: number): void {
  const vol = Math.max(0, Math.min(1, v))
  if (!session) return
  session.settings = { ...session.settings, volume: vol }
  if (session.audio) session.audio.volume = vol
}

/** Advance to chunk `i`, inserting the inter-sentence pause before it. */
function scheduleAdvance(i: number, play: (i: number) => void) {
  const count = session?.chunks.length ?? 0
  if (INTER_CHUNK_PAUSE_MS > 0 && i > 0 && i < count) {
    const t = token
    window.setTimeout(() => { if (alive(t)) play(i) }, INTER_CHUNK_PAUSE_MS)
  } else {
    play(i)
  }
}

// --- Browser engine: one queued utterance per chunk ---

function browserPlay(i: number) {
  const t = token
  if (!alive(t) || !session) return
  if (i >= session.chunks.length) { stopTts(); return }
  emit({ chunkIndex: i, status: 'playing' })
  const u = new SpeechSynthesisUtterance(session.chunks[i])
  const voices = window.speechSynthesis.getVoices()
  const voice = session.settings.browserVoiceURI ? voices.find((v) => v.voiceURI === session!.settings.browserVoiceURI) : undefined
  if (voice) u.voice = voice
  u.rate = session.settings.rate
  u.pitch = session.settings.pitch
  u.volume = session.settings.volume
  u.onend = () => { if (alive(t)) scheduleAdvance(i + 1, browserPlay) }
  u.onerror = () => { if (alive(t)) scheduleAdvance(i + 1, browserPlay) } // skip a failed chunk
  window.speechSynthesis.speak(u)
}

// --- Supertonic engine: a sequential producer synthesizes chunks ahead of
// playback (one at a time, off the main thread), while playback consumes the
// buffer. ---

function ensureSynth(i: number) {
  if (!session || i < 0 || i >= session.chunks.length) return
  if (session.blobs.has(i)) return
  const s = session
  const n = s.chunks.length
  const t0 = performance.now()
  ttsLog(`▶ generating chunk ${i + 1}/${n} (${s.chunks[i].length} chars)`)
  const p = synthChunk(s.settings, s.chunks[i])
  s.blobs.set(i, p)
  p.then(
    () => { if (s.token === token) { s.ready.add(i); ttsLog(`✓ chunk ${i + 1}/${n} ready in ${Math.round(performance.now() - t0)}ms`) } },
    (err) => ttsLog(`✗ chunk ${i + 1}/${n} failed: ${err instanceof Error ? err.message : String(err)} — text: ${JSON.stringify(s.chunks[i].slice(0, 80))}`),
  )
}

/** Synthesize every chunk in order, racing ahead of playback to fill the buffer. */
function startProducer(s: Session) {
  ttsLog(`queued ${s.chunks.length} chunk(s) for background synthesis`)
  void (async () => {
    for (let i = 0; i < s.chunks.length; i++) {
      if (token !== s.token) return
      ensureSynth(i)
      try { await s.blobs.get(i) } catch { /* a failed chunk is skipped at play time */ }
    }
  })()
}

async function neuralPlay(i: number) {
  const t = token
  if (!alive(t) || !session) return
  if (i >= session.chunks.length) {
    // Reached the end. If nothing ever played, every chunk failed — surface it.
    if (!session.played) { emit({ status: 'idle', activeId: null, error: 'Could not synthesize this passage.' }); reset() }
    else stopTts()
    return
  }

  ensureSynth(i)
  // Pre-generated chunks play seamlessly; only show loading when truly waiting.
  const wasReady = session.ready.has(i)
  ttsLog(`♪ playing chunk ${i + 1}/${session.chunks.length}${wasReady ? '' : ' (waiting for synthesis)'}`)
  emit({ chunkIndex: i, status: wasReady ? 'playing' : 'loading' })

  let blob: Blob
  try {
    blob = await session.blobs.get(i)!
  } catch {
    // One bad chunk shouldn't end the whole read — skip it and keep going.
    ttsLog(`↷ skipping chunk ${i + 1}/${session.chunks.length} (synthesis failed)`)
    if (alive(t)) scheduleAdvance(i + 1, (n) => { void neuralPlay(n) })
    return
  }
  if (!alive(t) || !session) return

  const audio = new Audio(URL.createObjectURL(blob))
  audio.volume = session.settings.volume
  audio.playbackRate = 1 // Supertonic bakes speed into synthesis
  audio.onended = () => {
    if (audio.src) URL.revokeObjectURL(audio.src)
    if (alive(t)) scheduleAdvance(i + 1, (n) => { void neuralPlay(n) })
  }
  audio.onerror = () => { if (alive(t)) scheduleAdvance(i + 1, (n) => { void neuralPlay(n) }) }
  session.audio = audio
  session.played = true
  emit({ chunkIndex: i, status: 'playing' })
  try { await audio.play() } catch { /* autoplay/interruption — state already set */ }
}

/**
 * Read `rawText` aloud, attributing playback to `id` so the player can show
 * which passage is active. Replaces any current playback.
 */
export function playFragment(id: string, rawText: string, title: string, settings: TtsSettings): void {
  stopTts()
  // Supertonic pays a fixed cost per chunk, so use larger chunks for it; the
  // browser engine is cheap.
  const max = settings.engine === 'supertonic' ? 360 : 240
  const chunks = chunkText(toPlainText(rawText), { max })
  if (chunks.length === 0) return

  const t = ++token
  session = { id, chunks, settings, token: t, blobs: new Map(), ready: new Set(), played: false, audio: null }
  emit({
    status: 'loading',
    activeId: id,
    title,
    chunkIndex: 0,
    chunkCount: chunks.length,
    engine: settings.engine,
    error: null,
  })

  if (settings.engine === 'browser') {
    if (!isBrowserTtsSupported()) {
      emit({ status: 'idle', activeId: null, error: 'Browser speech is not available here.' })
      reset()
      return
    }
    browserPlay(0)
    return
  }

  // Supertonic: kick off the producer (synthesizes in the worker) and start playback.
  startProducer(session)
  void neuralPlay(0)
}
