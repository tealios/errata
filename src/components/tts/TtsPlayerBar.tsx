import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Square, Loader2, AlertCircle, Volume2, Volume1, VolumeX, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTtsState, useTtsSettings, togglePlayPause, stopTts, setTtsVolume, setTtsPitch } from '@/lib/tts'

function PopSlider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-sans text-[0.6875rem] font-medium text-foreground/80">{label}</span>
        <span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border/60 accent-foreground"
      />
    </div>
  )
}

/**
 * Persistent "now reading" bar pinned to the bottom of the viewport while a
 * passage is read aloud. Reads the TTS store; mounts only when something is
 * playing, loading, or errored.
 */
export function TtsPlayerBar() {
  const { status, title, chunkIndex, chunkCount, engine, error } = useTtsState()
  const [settings, updateSettings] = useTtsSettings()
  const visible = status !== 'idle' || !!error

  const volume = settings.volume
  const lastAudible = useRef(volume > 0 ? volume : 1)
  useEffect(() => { if (volume > 0) lastAudible.current = volume }, [volume])
  const setVolume = (v: number) => { updateSettings({ volume: v }); setTtsVolume(v) }
  const setPitch = (v: number) => { updateSettings({ pitch: v }); setTtsPitch(v) }
  const setSpeed = (v: number) => updateSettings({ rate: v }) // applies to the next chunk/read
  const toggleMute = () => setVolume(volume > 0 ? 0 : lastAudible.current || 1)
  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  // "Tune" popover (speed / pitch / volume).
  const [tuneOpen, setTuneOpen] = useState(false)
  const tuneRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!tuneOpen) return
    const onDown = (e: MouseEvent) => { if (tuneRef.current && !tuneRef.current.contains(e.target as Node)) setTuneOpen(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [tuneOpen])

  // Mount-in transition (re-runs each time the bar appears for a new passage).
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!visible) { setShown(false); return }
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [visible])

  // Publish the bar's height so scroll regions can reserve space and not be
  // covered by this fixed overlay.
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = document.documentElement
    if (!visible) { root.style.removeProperty('--tts-bar-height'); return }
    root.style.setProperty('--tts-bar-height', `${barRef.current?.offsetHeight ?? 56}px`)
    return () => { root.style.removeProperty('--tts-bar-height') }
  }, [visible, error])

  if (!visible) return null

  const loading = status === 'loading'
  const playing = status === 'playing'
  // Current chunk counts as in-progress, so chunk i of n fills (i+1)/n.
  const fill = chunkCount > 0 ? Math.min(1, (chunkIndex + 1) / chunkCount) : 0

  return (
    <div
      ref={barRef}
      role="region"
      aria-label="Read-aloud player"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-card/95 backdrop-blur-md',
        'shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.18)]',
        'transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'motion-reduce:transition-none',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      {/* Progress as a hairline along the bar's top edge (keeps the bar slim) */}
      {!error && (
        <div
          className="absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-border/40"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={chunkCount}
          aria-valuenow={loading ? 0 : chunkIndex + 1}
          aria-label="Reading progress"
        >
          {loading ? (
            <span className="block h-full w-1/3 animate-[tts-indeterminate_1.4s_ease-in-out_infinite] bg-primary/60 motion-reduce:w-full motion-reduce:animate-none" />
          ) : (
            <span
              className="block h-full origin-left bg-primary/70 transition-transform duration-300 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${fill})` }}
            />
          )}
        </div>
      )}

      <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-1.5">
        {/* Primary affordance: play / pause / loading */}
        <button
          type="button"
          onClick={togglePlayPause}
          disabled={loading || !!error}
          aria-label={playing ? 'Pause reading' : 'Resume reading'}
          className={cn(
            'relative grid size-7 shrink-0 place-items-center rounded-full',
            'bg-primary/12 text-primary transition-colors',
            'hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            'disabled:cursor-default disabled:opacity-70',
          )}
        >
          {loading
            ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            : playing
              ? <Pause className="size-3.5" />
              : <Play className="size-3.5 translate-x-px" />}
        </button>

        {/* Now reading: title + counter, single line */}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate font-prose text-[0.8125rem] italic leading-tight text-foreground/85">
            {error
              ? <span className="inline-flex items-center gap-1.5 not-italic text-destructive"><AlertCircle className="size-3.5" />{error}</span>
              : (title || 'Reading passage')}
          </p>
          {!error && (
            <span className="shrink-0 font-mono text-[0.625rem] tabular-nums text-muted-foreground" aria-hidden>
              {loading ? 'generating…' : `${chunkIndex + 1} / ${chunkCount}`}
            </span>
          )}
        </div>

        {/* Mute + tune popover (speed / pitch / volume) */}
        {!error && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={volume === 0 ? 'Unmute' : 'Mute'}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <VolumeIcon className="size-3.5" />
            </button>
            <div className="relative" ref={tuneRef}>
              <button
                type="button"
                onClick={() => setTuneOpen((o) => !o)}
                aria-label="Playback settings"
                aria-expanded={tuneOpen}
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  tuneOpen ? 'bg-accent/60 text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <SlidersHorizontal className="size-3.5" />
              </button>
              {tuneOpen && (
                <div
                  role="dialog"
                  aria-label="Playback settings"
                  className="absolute bottom-full right-0 mb-2 w-52 space-y-3 rounded-lg border border-border/50 bg-card/95 p-3 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.3)] backdrop-blur-md"
                >
                  <PopSlider label="Speed" value={settings.rate} min={0.5} max={2} step={0.05} onChange={setSpeed} format={(v) => `${v.toFixed(2)}×`} />
                  <PopSlider label="Pitch" value={settings.pitch} min={0.5} max={2} step={0.05} onChange={setPitch} format={(v) => `${v.toFixed(2)}×`} />
                  <PopSlider label="Volume" value={volume} min={0} max={1} step={0.05} onChange={setVolume} format={(v) => `${Math.round(v * 100)}%`} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Engine hint + stop */}
        {engine && !error && (
          <span className="hidden shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-muted-foreground/70 sm:inline">
            {engine === 'supertonic' ? 'Supertonic' : 'Browser'}
          </span>
        )}
        <button
          type="button"
          onClick={stopTts}
          aria-label="Stop reading"
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors',
            'hover:bg-accent/60 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          )}
        >
          <Square className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
