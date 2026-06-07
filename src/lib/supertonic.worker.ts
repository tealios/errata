/**
 * Runs Supertonic neural TTS off the main thread via Transformers.js
 * (onnx-community/Supertonic-TTS-ONNX). The pipeline (text encoder + latent
 * denoiser + voice decoder) stays warm here across chunks. Tries WebGPU for
 * speed and falls back to WASM.
 *
 * Protocol: post { id, type:'synth', voiceId, text, steps, speed }; receive
 * { id, ok:true, buf:ArrayBuffer, mime } or { id, ok:false, error }.
 */
import { pipeline, env, type TextToAudioPipeline } from '@huggingface/transformers'

// Vite's dev HMR client is injected into worker modules and touches `document`,
// which doesn't exist in a worker — so HMR updates throw "document is not
// defined". Stub the handful of members it uses. No effect in production builds
// (no HMR client is injected there).
const g = globalThis as unknown as Record<string, unknown>
if (typeof g.document === 'undefined') {
  const noop = () => {}
  g.document = {
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({ setAttribute: noop, appendChild: noop, remove: noop, style: {} }),
    head: { appendChild: noop, removeChild: noop, insertBefore: noop },
    body: { appendChild: noop, removeChild: noop },
    addEventListener: noop,
    removeEventListener: noop,
  }
}

// Models are fetched from the Hugging Face Hub and cached by the browser.
env.allowLocalModels = false

const MODEL_ID = 'onnx-community/Supertonic-TTS-ONNX'
const VOICES_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main/voices`

interface WorkerCtx {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: string, listener: (e: Event) => void): void
}
const ctx = self as unknown as WorkerCtx

// Surface otherwise-invisible worker failures (module load, async aborts) to the
// main thread so they can be logged instead of appearing as a blank "crashed".
function reportFatal(msg: string) {
  try { ctx.postMessage({ type: 'fatal', error: msg }) } catch { /* ignore */ }
}
ctx.addEventListener('error', (e) => {
  const ev = e as ErrorEvent
  reportFatal(`${ev.message ?? 'error'}${ev.filename ? ` @ ${ev.filename}:${ev.lineno}` : ''}`)
})
ctx.addEventListener('unhandledrejection', (e) => {
  const reason = (e as PromiseRejectionEvent).reason
  reportFatal(`unhandledrejection: ${reason instanceof Error ? reason.message : String(reason)}`)
})

let ttsPromise: Promise<TextToAudioPipeline> | null = null

function getTts(): Promise<TextToAudioPipeline> {
  if (ttsPromise) return ttsPromise
  ttsPromise = (async () => {
    // Only attempt WebGPU when the worker actually exposes it; requesting an
    // unavailable backend can fail hard rather than reject cleanly.
    const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
    if (hasGpu) {
      try {
        return await pipeline('text-to-speech', MODEL_ID, { device: 'webgpu', dtype: 'fp32' })
      } catch { /* fall through to WASM */ }
    }
    return await pipeline('text-to-speech', MODEL_ID, { device: 'wasm', dtype: 'fp32' })
  })().catch((err) => { ttsPromise = null; throw err })
  return ttsPromise
}

interface SynthMessage {
  id: number
  type: string
  voiceId: string
  text: string
  steps?: number
  speed?: number
}

ctx.addEventListener('message', async (e: Event) => {
  const { id, type, voiceId, text, steps, speed } = (e as MessageEvent).data as SynthMessage
  if (type !== 'synth') return
  try {
    const tts = await getTts()
    const output = await tts(text, {
      speaker_embeddings: `${VOICES_BASE}/${voiceId}.bin`,
      num_inference_steps: steps ?? 5,
      speed: speed ?? 1,
    } as Record<string, unknown>)
    const blob = (output as { toBlob(): Blob }).toBlob()
    const buf = await blob.arrayBuffer()
    ctx.postMessage({ id, ok: true, buf, mime: blob.type || 'audio/wav' }, [buf])
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
