import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { Caption } from '@/components/ui/prose-text'
import { AlertCircle } from 'lucide-react'

/**
 * A dialog shell for "drop a file, preview, confirm" flows.
 *
 * Visuals are tuned for Errata's bookish aesthetic — sliding a loose page
 * into a book, not uploading to a SaaS. Reuses the shared
 * `tavern-dropzone-dash` / `tavern-dropzone-glow` animations for motion.
 *
 * The scaffold is intentionally lean: callers supply the parsed preview,
 * error text, and footer buttons. The standalone `<FileDropzone>` export
 * can be used outside a dialog.
 */

// ── Dialog shell ──────────────────────────────────────────────────────

type FileDropDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  /** Applied to DialogContent. Callers typically set a max-width here. */
  contentClassName?: string
  /** Hides the built-in close button on DialogContent. Default: false (shown). */
  showCloseButton?: boolean
  children?: React.ReactNode
}

function FileDropDialogRoot({
  open,
  onOpenChange,
  title,
  description,
  contentClassName,
  showCloseButton = false,
  children,
}: FileDropDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={showCloseButton}
        className={cn(
          'max-h-[85vh] flex flex-col overflow-hidden p-0 gap-0 border-border/60 bg-card',
          contentClassName,
        )}
      >
        <div className="px-6 pt-6 pb-4">
          <p className="font-display text-xl tracking-tight">{title}</p>
          {description && <Caption className="mt-1">{description}</Caption>}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 pb-4 flex flex-col gap-3">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Dropzone (also exported standalone) ───────────────────────────────

export type FileDropzoneProps = {
  /** Called with one or more files from drop or picker. */
  onFiles: (files: File[]) => void
  /** Accepted file types, same syntax as `<input accept="…">`. */
  accept?: string
  /** Allow picking / dropping multiple files. Default: false. */
  multiple?: boolean
  /** Serif italic helper line under the title. */
  hint?: React.ReactNode
  /** Title line inside the drop zone. Default: "Drop a file, or click to pick one." */
  label?: React.ReactNode
  /** Optional icon rendered above the label. */
  icon?: React.ReactNode
  /** Disable drop + click (e.g. while parsing). */
  disabled?: boolean
  /** Force the "active drop" visual from the outside. */
  forceActive?: boolean
  /** Additional classes on the wrapper. */
  className?: string
  /** Slot rendered inside the zone instead of the default label stack. */
  children?: React.ReactNode
}

/**
 * A bookish drop-and-pick zone. Clickable, keyboard-accessible
 * (Enter/Space opens the file picker). Uses the shared animated
 * dashed border + primary glow when active.
 */
export const FileDropzone = React.forwardRef<HTMLDivElement, FileDropzoneProps>(
  function FileDropzone(
    {
      onFiles,
      accept,
      multiple = false,
      hint,
      label = 'Drag a file here, or click to pick one.',
      icon,
      disabled = false,
      forceActive = false,
      className,
      children,
    },
    ref,
  ) {
    const inputRef = React.useRef<HTMLInputElement>(null)
    const [dragOver, setDragOver] = React.useState(false)
    const active = forceActive || dragOver

    const openPicker = React.useCallback(() => {
      if (disabled) return
      inputRef.current?.click()
    }, [disabled])

    const handleDrop = React.useCallback(
      (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        if (disabled) return
        const files = Array.from(e.dataTransfer.files ?? [])
        if (files.length > 0) onFiles(multiple ? files : [files[0]])
      },
      [onFiles, multiple, disabled],
    )

    const handleInput = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? [])
        if (files.length > 0) onFiles(multiple ? files : [files[0]])
        e.target.value = ''
      },
      [onFiles, multiple],
    )

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openPicker()
        }
      },
      [openPicker, disabled],
    )

    return (
      <div
        ref={ref}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'relative group rounded-xl overflow-hidden transition-all duration-300 outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
          active ? 'scale-[0.98]' : !disabled && 'hover:scale-[0.995]',
          className,
        )}
      >
        {/* Animated dashed border (reuses the tavern dropzone keyframes) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect
            x="1"
            y="1"
            width="calc(100% - 2px)"
            height="calc(100% - 2px)"
            rx="11"
            ry="11"
            fill="none"
            className={cn(
              'transition-all duration-300',
              active
                ? 'stroke-primary/50'
                : 'stroke-border/60 group-hover:stroke-border',
            )}
            strokeWidth="1.5"
            strokeDasharray="6 6"
            style={{ animation: 'tavern-dropzone-dash 1.5s linear infinite' }}
          />
        </svg>

        <div
          className={cn(
            'relative flex flex-col items-center justify-center py-12 px-8 transition-colors duration-300',
            active ? 'bg-primary/[0.04]' : 'bg-muted/30',
          )}
        >
          {children ?? (
            <>
              {icon && (
                <div
                  className={cn(
                    'relative mb-4 transition-all duration-300',
                    active ? 'scale-110' : 'group-hover:scale-105',
                  )}
                >
                  <div
                    className={cn(
                      'w-14 h-16 rounded-lg bg-gradient-to-b from-muted-foreground/[0.07] to-muted-foreground/[0.03] flex items-center justify-center overflow-hidden transition-colors duration-300',
                      active ? 'text-primary/40' : 'text-muted-foreground',
                    )}
                  >
                    {icon}
                  </div>
                  {active && (
                    <div
                      className="absolute -inset-3 rounded-2xl bg-primary/10 blur-lg"
                      style={{ animation: 'tavern-dropzone-glow 2s ease-in-out infinite' }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              )}
              <p
                className={cn(
                  'font-display italic text-sm tracking-tight transition-colors duration-200',
                  active ? 'text-primary' : 'text-foreground/70 group-hover:text-foreground/80',
                )}
              >
                {label}
              </p>
              {hint && (
                <p className="text-[0.6875rem] text-muted-foreground mt-1.5 text-center">
                  {hint}
                </p>
              )}
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={handleInput}
          tabIndex={-1}
        />
      </div>
    )
  },
)

// ── Compound slots ────────────────────────────────────────────────────

function FileDropDialogDropzone(props: FileDropzoneProps) {
  return <FileDropzone {...props} />
}

function FileDropDialogPreview({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  // Intentionally flat — no card frame. Consumers wrap their own container
  // if the preview needs one (e.g. a selectable grid).
  return <div className={cn('flex flex-col gap-2 min-h-0', className)}>{children}</div>
}

function FileDropDialogErrors({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  if (!children) return null
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 text-xs text-destructive/80 bg-destructive/5 rounded-lg px-3 py-2.5',
        className,
      )}
    >
      <AlertCircle className="size-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

function FileDropDialogActions({
  children,
  meta,
  className,
}: {
  children: React.ReactNode
  /** Left-aligned meta (e.g. "3 of 7 selected") sitting on the same row. */
  meta?: React.ReactNode
  className?: string
}) {
  return (
    <>
      <div className="px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
      </div>
      <DialogFooter className={cn('px-5 py-3.5 flex-row items-center', className)}>
        {meta && (
          <span className="text-[0.6875rem] text-muted-foreground mr-auto tabular-nums">
            {meta}
          </span>
        )}
        {children}
      </DialogFooter>
    </>
  )
}

// ── Public compound API ───────────────────────────────────────────────

export const FileDropDialog = Object.assign(FileDropDialogRoot, {
  Dropzone: FileDropDialogDropzone,
  Preview: FileDropDialogPreview,
  Errors: FileDropDialogErrors,
  Actions: FileDropDialogActions,
})
