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

// Models are fetched from the Hugging Face Hub and cached by the browser.
env.allowLocalModels = false

const MODEL_ID = 'onnx-community/Supertonic-TTS-ONNX'
const VOICES_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main/voices`

interface WorkerCtx {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
}
const ctx = self as unknown as WorkerCtx

let ttsPromise: Promise<TextToAudioPipeline> | null = null

function getTts(): Promise<TextToAudioPipeline> {
  if (ttsPromise) return ttsPromise
  ttsPromise = (async () => {
    try {
      return await pipeline('text-to-speech', MODEL_ID, { device: 'webgpu', dtype: 'fp32' })
    } catch {
      // No WebGPU in this worker — fall back to CPU/WASM.
      return await pipeline('text-to-speech', MODEL_ID, { device: 'wasm', dtype: 'fp32' })
    }
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

ctx.addEventListener('message', async (e: MessageEvent) => {
  const { id, type, voiceId, text, steps, speed } = e.data as SynthMessage
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
