/**
 * Shared settings primitives.
 *
 * One canonical set of building blocks for every settings surface (the main
 * SettingsPanel sections, TTS, Sharing, and any future settings panels). The
 * goal is consolidation, not a restyle: these match the existing warm, bookish,
 * quiet-typographic look (parchment / bronze OKLCH, text-[0.75rem] labels,
 * text-[0.625rem] muted descriptions, the pill toggle, the segmented control,
 * the thin range slider). Every interactive primitive accepts a `disabled` prop
 * that visibly greys it and blocks interaction.
 *
 * No em dashes in copy or comments by project convention; use commas, colons,
 * or periods.
 */
import type { ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHelp } from '@/hooks/use-help'

/**
 * SettingsSection: section wrapper for the scroll-snap settings layout.
 *
 * The root is a <section> that carries the caller's id plus data-toc and
 * data-toc-group attributes so the SettingsView table-of-contents scroll-spy
 * (which queries [data-toc]) can find and label it. It snaps to the top, fills
 * most of the settings viewport so short sections leave breathing room below,
 * and reserves scroll-margin for accurate jump targets.
 */
export function SettingsSection({
  id,
  label,
  group,
  children,
  className,
}: {
  id: string
  label: string
  group: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      id={id}
      data-toc={label}
      data-toc-group={group}
      className={cn('snap-start scroll-mt-2 min-h-[80vh] space-y-3', className)}
    >
      {children}
    </section>
  )
}

/**
 * SectionHeading: the small uppercase section label, with an optional help icon
 * that opens the in-app help to `helpTopic` (supports 'section#anchor'). Matches
 * the existing section / group label treatment. Pass `action` for a trailing
 * control such as a Reset button.
 */
export function SectionHeading({
  label,
  helpTopic,
  action,
  className,
}: {
  label: string
  helpTopic?: string
  action?: ReactNode
  className?: string
}) {
  const { openHelp } = useHelp()
  return (
    <div className={cn('mb-2 flex items-center justify-between gap-2', className)}>
      <div className="flex items-center gap-1.5">
        <label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">{label}</label>
        {helpTopic && (
          <button
            type="button"
            onClick={() => openHelp(helpTopic)}
            className="text-muted-foreground transition-colors hover:text-primary/60"
            title="Learn more"
          >
            <CircleHelp className="size-3" />
          </button>
        )}
      </div>
      {action}
    </div>
  )
}

/**
 * SettingsCard: the grouped container that holds a stack of SettingRows. Rounded
 * bordered box with hairline dividers between rows.
 */
export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border/30 divide-y divide-border/20', className)}>
      {children}
    </div>
  )
}

/**
 * SettingRow: a single labelled setting. Left side is the label plus optional
 * description and help icon; right side is the control passed as children. When
 * `disabled`, the whole row is greyed and pointer events are blocked so the
 * control inside cannot be reached.
 */
export function SettingRow({
  label,
  description,
  helpTopic,
  children,
  disabled,
  className,
}: {
  label: string
  description?: string
  helpTopic?: string
  children: ReactNode
  disabled?: boolean
  className?: string
}) {
  const { openHelp } = useHelp()
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-3 py-2',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
      aria-disabled={disabled || undefined}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-[0.75rem] font-medium text-foreground/80">{label}</p>
          {helpTopic && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openHelp(helpTopic) }}
              className="text-muted-foreground transition-colors hover:text-primary/60"
              title="Learn more"
            >
              <CircleHelp className="size-3" />
            </button>
          )}
        </div>
        {description && <p className="mt-0.5 text-[0.625rem] leading-snug text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/**
 * Toggle: the pill switch. `label` is the accessible name for the control.
 * Greys and blocks interaction when `disabled`.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      aria-label={label}
      aria-pressed={checked}
      className={cn(
        'relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-foreground' : 'bg-muted-foreground/20',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-background transition-[left] duration-150',
          checked ? 'left-[16px]' : 'left-[2px]',
        )}
      />
    </button>
  )
}

/**
 * SegmentedControl: a row of mutually exclusive pill-segment buttons. The active
 * segment inverts to foreground-on-background. Greys and blocks interaction when
 * `disabled`.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'flex h-[26px] overflow-hidden rounded-md border border-border/40',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          disabled={disabled}
          className={cn(
            'px-2.5 text-[0.6875rem] font-medium transition-colors',
            value === opt.value
              ? 'bg-foreground text-background'
              : 'bg-transparent text-muted-foreground hover:text-foreground/70',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Slider: a labelled range input with the formatted value shown to the right of
 * the label. `format` turns the numeric value into the display string (for
 * example "1.25x" or "80%"). Greys and blocks interaction when `disabled`.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
  disabled?: boolean
}) {
  return (
    <div className={cn('px-3 py-2.5', disabled && 'opacity-40')}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="text-[0.75rem] font-medium text-foreground/80">{label}</p>
        <span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border/60 accent-foreground disabled:cursor-not-allowed"
        aria-label={label}
      />
    </div>
  )
}

/**
 * Shared class for a compact styled <select>. Exported so panels with bespoke
 * select markup (option lists they build inline) can stay visually identical
 * without re-deriving the class string.
 */
export const selectClass =
  'h-[26px] rounded-md border border-border/40 bg-background px-2 text-[0.6875rem] text-foreground focus:border-foreground/20 focus:outline-none disabled:opacity-40'

/**
 * SettingsSelect: a styled <select> wrapper. Pass <option> elements as children.
 * Greys and disables when `disabled`. `className` is merged onto selectClass for
 * per-use width constraints such as max-w-[11rem].
 */
export function SettingsSelect({
  value,
  onChange,
  disabled,
  className,
  children,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(selectClass, className)}
    >
      {children}
    </select>
  )
}

/**
 * NumberField: a compact, centered numeric input for values like Max steps or
 * Context limit. Mirrors the monospace stepper styling used today. Only commits
 * values that parse and fall within min/max when those bounds are given. Greys
 * and disables when `disabled`.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  disabled?: boolean
  className?: string
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const v = parseInt(e.target.value, 10)
        if (Number.isNaN(v)) return
        if (min !== undefined && v < min) return
        if (max !== undefined && v > max) return
        onChange(v)
      }}
      disabled={disabled}
      className={cn(
        'h-[26px] w-14 rounded-md border border-border/40 bg-background px-2 text-center font-mono text-[0.6875rem] focus:border-foreground/20 focus:outline-none disabled:opacity-40',
        className,
      )}
    />
  )
}
