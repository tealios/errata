import { useMemo } from 'react'
import { generateGuilloche } from '@/lib/fragment-visuals'
import { useTheme } from '@/lib/theme'

interface GuillochePatternProps {
  id: string
  className?: string
}

/**
 * Renders a deterministic guilloche pattern as an SVG background.
 * The pattern is seeded from the provided ID, so the same ID always
 * produces the same pattern. Used as a placeholder on story cards.
 * Adapts to light/dark theme automatically.
 */
export function GuillochePattern({ id, className }: GuillochePatternProps) {
  const { theme } = useTheme()
  const mode = theme === 'light' ? 'light' : 'dark'
  const data = useMemo(() => generateGuilloche(id, 300, 400, mode), [id, mode])

  return (
    <div className={className} style={{ backgroundColor: data.palette.bg }}>
      <svg
        viewBox="0 0 300 400"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Subtle soft glow for loop curves */}
          <filter id={`soft-${id}`}>
            <feGaussianBlur stdDeviation="0.8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Soft radial warmth in center */}
        <radialGradient id={`bg-grad-${id}`} cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor={data.palette.accent} stopOpacity="0.05" />
          <stop offset="100%" stopColor={data.palette.bg} stopOpacity="0" />
        </radialGradient>
        <rect width="300" height="400" fill={`url(#bg-grad-${id})`} />

        {/* Wave ribbon bands */}
        {data.wavePaths.map((wave, i) => (
          <path
            key={`wave-${i}`}
            d={wave.d}
            fill="none"
            stroke={wave.color}
            strokeWidth="0.4"
            opacity={wave.opacity}
            strokeLinecap="round"
          />
        ))}

        {/* Lissajous loop ribbons with soft glow */}
        <g filter={`url(#soft-${id})`}>
          {data.svgPaths.map((path, i) => (
            <path
              key={`curve-${i}`}
              d={path.d}
              fill="none"
              stroke={path.color}
              strokeWidth={path.strokeWidth}
              opacity={path.opacity}
              strokeLinejoin="round"
            />
          ))}
        </g>

        {/* Faint accent highlight on the center-most loop line */}
        {data.svgPaths.length > 2 && (
          <path
            d={data.svgPaths[Math.floor(data.svgPaths.length / 2)].d}
            fill="none"
            stroke={data.palette.accent}
            strokeWidth={0.12}
            opacity={0.15}
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  )
}
