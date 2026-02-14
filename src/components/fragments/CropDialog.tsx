import { useState, useRef, useCallback, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { BoundaryBox } from '@/lib/fragment-visuals'
import { Crop, RotateCcw } from 'lucide-react'

interface CropDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageUrl: string
  imageName: string
  initialBoundary?: BoundaryBox
  onApply: (boundary: BoundaryBox | undefined) => void
}

type DragMode = 'none' | 'create' | 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-w' | 'resize-e'

const MIN_SIZE = 0.02 // minimum crop size (2% of image)

export function CropDialog({ open, onOpenChange, imageUrl, imageName, initialBoundary, onApply }: CropDialogProps) {
  const [boundary, setBoundary] = useState<BoundaryBox | null>(initialBoundary ?? null)
  const [dragMode, setDragMode] = useState<DragMode>('none')
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [dragOrigBoundary, setDragOrigBoundary] = useState<BoundaryBox | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setBoundary(initialBoundary ?? null)
      setDragMode('none')
    }
  }, [open, initialBoundary])

  const getNormalizedPos = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }, [])

  const getResizeCursor = (mode: DragMode): string => {
    switch (mode) {
      case 'resize-nw': case 'resize-se': return 'nwse-resize'
      case 'resize-ne': case 'resize-sw': return 'nesw-resize'
      case 'resize-n': case 'resize-s': return 'ns-resize'
      case 'resize-w': case 'resize-e': return 'ew-resize'
      case 'move': return 'move'
      default: return 'crosshair'
    }
  }

  const hitTest = useCallback((pos: { x: number; y: number }): DragMode => {
    if (!boundary) return 'create'

    const { x, y, width, height } = boundary
    const edge = 0.02 // edge grab zone (2% of image)

    const inX = pos.x >= x - edge && pos.x <= x + width + edge
    const inY = pos.y >= y - edge && pos.y <= y + height + edge

    if (!inX || !inY) return 'create'

    const nearLeft = Math.abs(pos.x - x) < edge
    const nearRight = Math.abs(pos.x - (x + width)) < edge
    const nearTop = Math.abs(pos.y - y) < edge
    const nearBottom = Math.abs(pos.y - (y + height)) < edge

    if (nearTop && nearLeft) return 'resize-nw'
    if (nearTop && nearRight) return 'resize-ne'
    if (nearBottom && nearLeft) return 'resize-sw'
    if (nearBottom && nearRight) return 'resize-se'
    if (nearTop) return 'resize-n'
    if (nearBottom) return 'resize-s'
    if (nearLeft) return 'resize-w'
    if (nearRight) return 'resize-e'

    if (pos.x >= x && pos.x <= x + width && pos.y >= y && pos.y <= y + height) return 'move'

    return 'create'
  }, [boundary])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const pos = getNormalizedPos(e)
    if (!pos) return

    const mode = hitTest(pos)
    setDragMode(mode)
    setDragStart(pos)
    setDragOrigBoundary(boundary ? { ...boundary } : null)

    if (mode === 'create') {
      setBoundary({ x: pos.x, y: pos.y, width: 0, height: 0 })
    }
  }, [getNormalizedPos, hitTest, boundary])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragMode === 'none') {
      // Just update cursor
      const pos = getNormalizedPos(e)
      if (pos && containerRef.current) {
        const mode = hitTest(pos)
        containerRef.current.style.cursor = getResizeCursor(mode)
      }
      return
    }

    e.preventDefault()
    const pos = getNormalizedPos(e)
    if (!pos) return

    const dx = pos.x - dragStart.x
    const dy = pos.y - dragStart.y

    if (dragMode === 'create') {
      const x = Math.min(dragStart.x, pos.x)
      const y = Math.min(dragStart.y, pos.y)
      const w = Math.abs(pos.x - dragStart.x)
      const h = Math.abs(pos.y - dragStart.y)
      setBoundary({ x, y, width: w, height: h })
    } else if (dragMode === 'move' && dragOrigBoundary) {
      let nx = dragOrigBoundary.x + dx
      let ny = dragOrigBoundary.y + dy
      nx = Math.max(0, Math.min(1 - dragOrigBoundary.width, nx))
      ny = Math.max(0, Math.min(1 - dragOrigBoundary.height, ny))
      setBoundary({ x: nx, y: ny, width: dragOrigBoundary.width, height: dragOrigBoundary.height })
    } else if (dragOrigBoundary) {
      // Resize modes
      let { x, y, width, height } = dragOrigBoundary

      if (dragMode.includes('e')) {
        width = Math.max(MIN_SIZE, Math.min(1 - x, width + dx))
      }
      if (dragMode.includes('w')) {
        const newX = Math.max(0, x + dx)
        width = Math.max(MIN_SIZE, width - (newX - x))
        x = newX
      }
      if (dragMode.includes('s')) {
        height = Math.max(MIN_SIZE, Math.min(1 - y, height + dy))
      }
      if (dragMode.includes('n')) {
        const newY = Math.max(0, y + dy)
        height = Math.max(MIN_SIZE, height - (newY - y))
        y = newY
      }

      setBoundary({ x, y, width, height })
    }
  }, [dragMode, dragStart, dragOrigBoundary, getNormalizedPos, hitTest])

  const handleMouseUp = useCallback(() => {
    if (dragMode === 'create' && boundary && boundary.width < MIN_SIZE && boundary.height < MIN_SIZE) {
      // Too small — treat as a click to clear
      setBoundary(null)
    }
    setDragMode('none')
  }, [dragMode, boundary])

  const handleApply = () => {
    if (boundary && boundary.width >= MIN_SIZE && boundary.height >= MIN_SIZE) {
      onApply({
        x: Math.round(boundary.x * 1000) / 1000,
        y: Math.round(boundary.y * 1000) / 1000,
        width: Math.round(boundary.width * 1000) / 1000,
        height: Math.round(boundary.height * 1000) / 1000,
      })
    } else {
      onApply(undefined)
    }
    onOpenChange(false)
  }

  const handleReset = () => {
    setBoundary(null)
  }

  const hasCrop = boundary && boundary.width >= MIN_SIZE && boundary.height >= MIN_SIZE

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Crop className="size-4 text-muted-foreground" />
            Crop region
            <span className="text-muted-foreground/50 font-normal">— {imageName}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Crop canvas */}
        <div className="px-5 flex justify-center">
          <div
            ref={containerRef}
            className="relative w-fit max-w-full rounded-lg overflow-hidden border border-border/40 bg-muted/10 select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: dragMode !== 'none' ? getResizeCursor(dragMode) : 'crosshair' }}
          >
            <img
              src={imageUrl}
              alt={imageName}
              className="block max-w-full h-auto"
              draggable={false}
              style={{ maxHeight: '60vh' }}
            />

            {/* Dimming overlay — 4 rects around the crop area */}
            {hasCrop && (
              <>
                {/* Top */}
                <div
                  className="absolute left-0 right-0 top-0 bg-black/50 pointer-events-none"
                  style={{ height: `${boundary.y * 100}%` }}
                />
                {/* Bottom */}
                <div
                  className="absolute left-0 right-0 bottom-0 bg-black/50 pointer-events-none"
                  style={{ height: `${(1 - boundary.y - boundary.height) * 100}%` }}
                />
                {/* Left */}
                <div
                  className="absolute left-0 bg-black/50 pointer-events-none"
                  style={{
                    top: `${boundary.y * 100}%`,
                    height: `${boundary.height * 100}%`,
                    width: `${boundary.x * 100}%`,
                  }}
                />
                {/* Right */}
                <div
                  className="absolute right-0 bg-black/50 pointer-events-none"
                  style={{
                    top: `${boundary.y * 100}%`,
                    height: `${boundary.height * 100}%`,
                    width: `${(1 - boundary.x - boundary.width) * 100}%`,
                  }}
                />

                {/* Crop rectangle border + handles */}
                <div
                  className="absolute border-2 border-white/90 pointer-events-none"
                  style={{
                    left: `${boundary.x * 100}%`,
                    top: `${boundary.y * 100}%`,
                    width: `${boundary.width * 100}%`,
                    height: `${boundary.height * 100}%`,
                  }}
                >
                  {/* Rule-of-thirds grid */}
                  <div className="absolute inset-0">
                    <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/25" />
                    <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/25" />
                    <div className="absolute top-1/3 left-0 right-0 h-px bg-white/25" />
                    <div className="absolute top-2/3 left-0 right-0 h-px bg-white/25" />
                  </div>

                  {/* Corner handles */}
                  <div className="absolute -top-1 -left-1 size-2.5 bg-white rounded-sm shadow-sm" />
                  <div className="absolute -top-1 -right-1 size-2.5 bg-white rounded-sm shadow-sm" />
                  <div className="absolute -bottom-1 -left-1 size-2.5 bg-white rounded-sm shadow-sm" />
                  <div className="absolute -bottom-1 -right-1 size-2.5 bg-white rounded-sm shadow-sm" />

                  {/* Edge handles */}
                  <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-6 h-1 bg-white rounded-full shadow-sm" />
                  <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-6 h-1 bg-white rounded-full shadow-sm" />
                  <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 h-6 w-1 bg-white rounded-full shadow-sm" />
                  <div className="absolute -right-0.5 top-1/2 -translate-y-1/2 h-6 w-1 bg-white rounded-full shadow-sm" />
                </div>
              </>
            )}

            {/* Instruction overlay when no crop */}
            {!hasCrop && dragMode === 'none' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2.5">
                  <p className="text-white/90 text-xs font-medium">Click and drag to select a crop region</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-5 py-4">
          <div className="flex items-center gap-2 w-full">
            {/* Coordinates readout */}
            {hasCrop && (
              <div className="flex-1 flex items-center gap-3">
                <span className="text-[10px] font-mono text-muted-foreground/50">
                  {Math.round(boundary.x * 100)}%, {Math.round(boundary.y * 100)}%
                  {' '}&mdash;{' '}
                  {Math.round(boundary.width * 100)}% &times; {Math.round(boundary.height * 100)}%
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[11px] gap-1 text-muted-foreground/50 hover:text-muted-foreground"
                  onClick={handleReset}
                >
                  <RotateCcw className="size-3" />
                  Reset
                </Button>
              </div>
            )}
            {!hasCrop && <div className="flex-1" />}

            <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" className="h-8 text-xs gap-1.5" onClick={handleApply}>
              <Crop className="size-3" />
              {hasCrop ? 'Apply crop' : 'No crop'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
