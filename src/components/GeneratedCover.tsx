import { useMemo } from 'react'
import { getCoverSvgMarkup, type CoverMode } from '@/lib/cover-generator'
import { useTheme } from '@/lib/theme'

interface GeneratedCoverProps {
  /** Seed token — typically the story name or ID */
  token: string
  className?: string
}

/**
 * Renders a deterministic, procedurally generated SVG cover.
 * Seeded from `token` so the same input always produces the same visual.
 * Adapts palettes and texture to light/dark theme automatically.
 */
export function GeneratedCover({ token, className }: GeneratedCoverProps) {
  const { theme } = useTheme()
  const mode: CoverMode = theme === 'light' ? 'light' : 'dark'
  const svgMarkup = useMemo(() => getCoverSvgMarkup(token, mode), [token, mode])

  return (
    <div className={className}>
      <svg
        viewBox="0 0 400 600"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    </div>
  )
}
