import { useRef } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { useProseColors, type ProseColorConfig } from '@/lib/theme'

interface ColorChannel {
  key: keyof ProseColorConfig
  label: string
  description: string
  defaultHint: string
}

const CHANNELS: ColorChannel[] = [
  {
    key: 'dialogue',
    label: 'Dialogue',
    description: 'Quoted speech wrapped in double quotes',
    defaultHint: 'Muted blue',
  },
  {
    key: 'narration',
    label: 'Narration',
    description: 'Base prose text color',
    defaultHint: 'Theme foreground',
  },
  {
    key: 'emphasis',
    label: 'Emphasis',
    description: 'Italic text outside of dialogue',
    defaultHint: 'Inherits narration',
  },
]

const PRESETS: Record<keyof ProseColorConfig, string[]> = {
  dialogue: [
    '#6b8aad', // muted blue (close to default)
    '#b08d57', // warm gold
    '#8b7bb5', // soft purple
    '#5a9e8f', // teal
    '#c97a7a', // dusty rose
    '#7ea87e', // sage green
    '#d4956a', // burnt sienna
    '#a0a0a0', // neutral gray
  ],
  narration: [
    '#d4cfc4', // parchment (dark mode)
    '#2d2a24', // dark ink (light mode)
    '#c5bfb0', // warm cream
    '#b8c4ce', // cool gray
    '#d1c5b5', // aged paper
    '#a8b8a0', // green-tinted
    '#c4b8c8', // lavender tint
    '#bfbfbf', // neutral
  ],
  emphasis: [
    '#a89070', // warm muted
    '#8899aa', // cool steel
    '#b5967a', // copper
    '#7a9988', // moss
    '#aa8899', // mauve
    '#9aaa7a', // olive
    '#7a8aaa', // slate blue
    '#888888', // dim
  ],
}

function ColorSwatch({
  color,
  isActive,
  onClick,
}: {
  color: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`size-6 rounded-full border-2 transition-all duration-150 hover:scale-110 ${
        isActive
          ? 'border-foreground shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--foreground)]'
          : 'border-border/40 hover:border-foreground/30'
      }`}
      style={{ backgroundColor: color }}
      title={color}
    />
  )
}

function ColorRow({
  channel,
  value,
  onChange,
  onClear,
}: {
  channel: ColorChannel
  value: string | undefined
  onChange: (color: string) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const presets = PRESETS[channel.key]

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <p className="text-[0.75rem] font-medium text-foreground/80">{channel.label}</p>
          <p className="text-[0.625rem] text-muted-foreground leading-snug">{channel.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {value && (
            <button
              type="button"
              onClick={onClear}
              className="text-muted-foreground hover:text-foreground/60 transition-colors"
              title="Reset to default"
            >
              <X className="size-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="size-7 rounded-md border border-border/40 hover:border-foreground/30 transition-colors cursor-pointer relative overflow-hidden"
            style={{ backgroundColor: value || 'transparent' }}
            title={value || `Default (${channel.defaultHint})`}
          >
            {!value && (
              <span className="absolute inset-0 flex items-center justify-center text-[0.5rem] text-muted-foreground">
                —
              </span>
            )}
          </button>
          <input
            ref={inputRef}
            type="color"
            value={value || '#888888'}
            onChange={(e) => onChange(e.target.value)}
            className="sr-only"
            tabIndex={-1}
          />
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        {presets.map((preset) => (
          <ColorSwatch
            key={preset}
            color={preset}
            isActive={value === preset}
            onClick={() => onChange(preset)}
          />
        ))}
      </div>
    </div>
  )
}

const PREVIEW_TEXT = `The rain hammered against the cobblestones as she rounded the corner.

"I didn't think you'd come," he said, stepping out from under the awning.

She paused, *weighing her options carefully*, before answering.

"Someone had to," she replied. "And it certainly wasn't going to be Marcus."`

/**
 * Inline prose-color controls: channel rows, preset swatches, and a live preview,
 * without the standalone panel header, back button, or onClose chrome. Designed to
 * be embedded directly inside the Appearance settings section. Keeps a compact
 * inline "Reset all" affordance that appears once any color is customized.
 */
export function ProseColorsControls() {
  const [colors, setColors, resetColors] = useProseColors()

  const hasCustomColors = Object.values(colors).some(Boolean)

  const updateColor = (key: keyof ProseColorConfig, value: string) => {
    setColors({ ...colors, [key]: value })
  }

  const clearColor = (key: keyof ProseColorConfig) => {
    const next = { ...colors }
    delete next[key]
    setColors(next)
  }

  return (
    <div className="rounded-lg border border-border/30 divide-y divide-border/20">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-[0.75rem] font-medium text-foreground/80">Prose colors</p>
        {hasCustomColors && (
          <button
            type="button"
            onClick={resetColors}
            className="flex items-center gap-1 text-[0.625rem] text-muted-foreground hover:text-foreground/60 transition-colors"
          >
            <RotateCcw className="size-2.5" />
            Reset all
          </button>
        )}
      </div>

      {CHANNELS.map((channel) => (
        <ColorRow
          key={channel.key}
          channel={channel}
          value={colors[channel.key]}
          onChange={(color) => updateColor(channel.key, color)}
          onClear={() => clearColor(channel.key)}
        />
      ))}

      {/* Live preview */}
      <div className="px-4 py-4">
        <p className="text-[0.625rem] text-muted-foreground uppercase tracking-wider mb-2">
          Preview
        </p>
        <div
          className="prose-content rounded-lg border border-border/20 bg-background p-4 text-[0.8125rem] leading-relaxed"
        >
          {PREVIEW_TEXT.split('\n\n').map((para, i) => {
            // Simple rendering: detect dialogue and emphasis for preview
            const parts = para.split(/("[^"]*")/g)
            return (
              <p key={i} className={i > 0 ? 'mt-3' : ''}>
                {parts.map((part, j) => {
                  if (part.startsWith('"') && part.endsWith('"')) {
                    return (
                      <em key={j} className="prose-dialogue">
                        {part}
                      </em>
                    )
                  }
                  // Handle emphasis markers
                  const emphParts = part.split(/(\*[^*]+\*)/g)
                  return emphParts.map((ep, k) => {
                    if (ep.startsWith('*') && ep.endsWith('*')) {
                      return (
                        <em key={`${j}-${k}`}>
                          {ep.slice(1, -1)}
                        </em>
                      )
                    }
                    return ep
                  })
                })}
              </p>
            )
          })}
        </div>
      </div>
    </div>
  )
}
