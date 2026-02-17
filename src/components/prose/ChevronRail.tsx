import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ChevronRailProps {
  direction: 'prev' | 'next'
  disabled: boolean
  onClick: () => void
  fragmentId: string
}

/** Full-height chevron rail that follows cursor vertically */
export function ChevronRail({ direction, disabled, onClick, fragmentId }: ChevronRailProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const [chevronY, setChevronY] = useState<number | null>(null)
  const [proximity, setProximity] = useState(0)
  const isLeft = direction === 'prev'

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const block = rail.closest('[data-prose-index]') as HTMLElement | null
    if (!block) return

    const handleMove = (e: MouseEvent) => {
      const blockRect = block.getBoundingClientRect()
      const railRect = rail.getBoundingClientRect()

      // Chevron Y position relative to rail
      const relY = e.clientY - railRect.top
      const clamped = Math.max(12, Math.min(relY, railRect.height - 12))
      setChevronY(clamped)

      // Proximity: how close the cursor is to the rail edge (0=far, 1=on it)
      const distFromEdge = isLeft
        ? e.clientX - blockRect.left
        : blockRect.right - e.clientX
      // Map 0..120px from edge → 1..0 proximity
      const norm = Math.max(0, Math.min(1, 1 - distFromEdge / 120))
      setProximity(norm)
    }

    const handleLeave = () => {
      setChevronY(null)
      setProximity(0)
    }

    block.addEventListener('mousemove', handleMove)
    block.addEventListener('mouseleave', handleLeave)
    return () => {
      block.removeEventListener('mousemove', handleMove)
      block.removeEventListener('mouseleave', handleLeave)
    }
  }, [isLeft])

  return (
    <div
      ref={railRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={isLeft ? 'Previous variation' : 'Next variation'}
      className={`absolute top-0 bottom-0 w-12 z-20 flex items-center justify-center ${
        isLeft ? '-left-12' : '-right-12'
      }`}
      style={{ cursor: disabled ? 'default' : 'pointer' }}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick() }}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick() } }}
      data-component-id={`prose-${fragmentId}-variation-${direction}`}
    >
      <div
        className="absolute transition-opacity duration-75"
        style={{
          top: chevronY !== null ? chevronY - 12 : '50%',
          transform: chevronY === null ? 'translateY(-50%)' : undefined,
          opacity: disabled ? 0.08 : Math.max(0.08, proximity * 0.7),
        }}
      >
        {isLeft
          ? <ChevronLeft className="size-6 text-muted-foreground" />
          : <ChevronRight className="size-6 text-muted-foreground" />
        }
      </div>
    </div>
  )
}
