import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  type Placement,
} from '@floating-ui/react'
import type { Editor } from '@tiptap/react'

interface FloatingElementProps {
  editor: Editor | null
  shouldShow?: boolean
  placement?: Placement
  offsetValue?: number
  zIndex?: number
  closeOnEscape?: boolean
  children: React.ReactNode
}

/**
 * Returns a DOMRect representing the bounding box of the editor's current selection.
 */
function getSelectionBoundingRect(editor: Editor): DOMRect | null {
  const { state, view } = editor
  const { from, to } = state.selection

  if (from === to) return null

  const start = view.coordsAtPos(from)
  const end = view.coordsAtPos(to)

  const top = Math.min(start.top, end.top)
  const bottom = Math.max(start.bottom, end.bottom)
  const left = Math.min(start.left, end.left)
  const right = Math.max(start.right, end.right)

  return new DOMRect(left, top, right - left, bottom - top)
}

/**
 * A floating UI element that positions itself relative to the current
 * text selection in a Tiptap editor. Drop-in replacement for BubbleMenu
 * with more control over positioning and behavior.
 */
export function FloatingElement({
  editor,
  shouldShow = false,
  placement = 'top',
  offsetValue = 8,
  zIndex = 200,
  closeOnEscape = false,
  children,
}: FloatingElementProps) {
  const [isOpen, setIsOpen] = useState(false)
  const virtualRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => new DOMRect(),
  })

  const { refs, floatingStyles } = useFloating({
    placement,
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [
      offset(offsetValue),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: autoUpdate,
  })

  // Update virtual reference rect from selection
  const updatePosition = useCallback(() => {
    if (!editor || !shouldShow) return
    const rect = getSelectionBoundingRect(editor)
    if (rect) {
      const virtual = { getBoundingClientRect: () => rect }
      virtualRef.current = virtual
      refs.setPositionReference(virtual)
    }
  }, [editor, shouldShow, refs])

  // Subscribe to editor selection updates
  useEffect(() => {
    if (!editor) return
    const onUpdate = () => {
      updatePosition()
    }
    editor.on('selectionUpdate', onUpdate)
    editor.on('transaction', onUpdate)
    return () => {
      editor.off('selectionUpdate', onUpdate)
      editor.off('transaction', onUpdate)
    }
  }, [editor, updatePosition])

  // Sync visibility
  useEffect(() => {
    setIsOpen(shouldShow)
    if (shouldShow) updatePosition()
  }, [shouldShow, updatePosition])

  // Escape to close
  useEffect(() => {
    if (!closeOnEscape || !isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeOnEscape, isOpen])

  if (!isOpen || !editor) return null

  return (
    <div
      ref={refs.setFloating}
      style={{ ...floatingStyles, zIndex }}
      // Prevent clicks from stealing focus from editor
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  )
}
