/**
 * Errata Logo — a printer's ornament asterisk.
 *
 * Six tapered petals radiate from a central dot, alternating between
 * primary (larger) and secondary (smaller) arms.  The shape evokes
 * the traditional asterisk/footnote mark used in errata sheets.
 *
 * Variants:
 *  - "icon"     — the mark only
 *  - "wordmark" — "Errata" text only (Instrument Serif italic)
 *  - "full"     — mark + wordmark side-by-side
 */

interface ErrataLogoProps {
  variant?: 'icon' | 'wordmark' | 'full'
  size?: number
  className?: string
}

// Petal shape: a smooth leaf/diamond pointing upward from center
const PETAL = 'M 0 -8 C 1.6 -5.2 1.6 -1.2 0 0.8 C -1.6 -1.2 -1.6 -5.2 0 -8 Z'

const PETALS = [
  { angle: 0, scale: 1 },
  { angle: 60, scale: 0.7 },
  { angle: 120, scale: 1 },
  { angle: 180, scale: 0.7 },
  { angle: 240, scale: 1 },
  { angle: 300, scale: 0.7 },
]

export function ErrataMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      {PETALS.map(({ angle, scale }) => (
        <path
          key={angle}
          d={PETAL}
          fill="currentColor"
          transform={`translate(12, 12) rotate(${angle}) scale(${scale})`}
        />
      ))}
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  )
}

export function ErrataLogo({ variant = 'full', size = 24, className }: ErrataLogoProps) {
  if (variant === 'icon') {
    return <ErrataMark size={size} className={className} />
  }

  if (variant === 'wordmark') {
    return (
      <span
        className={`font-display italic tracking-tight leading-none ${className ?? ''}`}
        style={{ fontSize: size }}
      >
        Errata
      </span>
    )
  }

  // full: icon + wordmark
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <ErrataMark size={size * 0.85} />
      <span
        className="font-display italic tracking-tight leading-none"
        style={{ fontSize: size }}
      >
        Errata
      </span>
    </span>
  )
}
