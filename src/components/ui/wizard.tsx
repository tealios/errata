import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Caption } from '@/components/ui/prose-text'

/**
 * Wizard scaffold.
 *
 * A compound component for multi-step flows (story setup, onboarding). Provides
 * the shared skeleton — step transition, header (serif title + caption), body,
 * footer with back/next — while leaving step-specific content untouched.
 *
 * The typographic feel is bookish: chapter-heading titles in the display serif,
 * Roman-numeral page counts (iii / vii), no percent bars, no stepper dots with
 * check-marks. Transition uses the existing `animate-wizard-step-enter`; under
 * `prefers-reduced-motion` it collapses to `animate-onboarding-fade-in` (pure
 * opacity fade).
 *
 * Keyboard:
 *  - Enter            → advance, when the current step passes `canAdvance`
 *  - Escape           → invoke `onClose`, if provided
 *  - Left/Right arrow → intentionally NOT bound (text inputs own them)
 */

// ── Context ────────────────────────────────────────────

interface WizardContextValue {
  /** Stable key of the active step. */
  stepKey: string
  /** 0-based index of the active step; -1 if unknown. */
  stepIndex: number
  /** Total step count shown in progress indicator. May exclude terminal steps. */
  total: number
  /** Close handler, exposed for Escape-driven exits. */
  onClose?: () => void
  /** Set by Wizard.Step so the scaffold knows the current step's key. */
  setActiveStepKey: (key: string, index: number) => void
}

const WizardContext = React.createContext<WizardContextValue | null>(null)

function useWizardContext() {
  const ctx = React.useContext(WizardContext)
  if (!ctx) throw new Error('Wizard.* must be used inside <Wizard>.')
  return ctx
}

// ── Root ───────────────────────────────────────────────

export interface WizardProps {
  /** Key of the currently-visible step. Must match a `<Wizard.Step stepKey>`. */
  step: string
  /** Total steps shown in the progress indicator. Defaults to children count. */
  total?: number
  /**
   * Fallback Enter-key advance handler. Normally not needed — `<Wizard.NextButton>`
   * registers its own and that is what Enter invokes. Use this only if a step
   * wants Enter to advance without a visible NextButton.
   */
  onAdvance?: () => void
  /** Escape-key close. If omitted, Escape does nothing. */
  onClose?: () => void
  className?: string
  children: React.ReactNode
}

export function Wizard({
  step,
  total,
  onAdvance,
  onClose,
  className,
  children,
}: WizardProps) {
  const [active, setActive] = React.useState<{ key: string; index: number }>({
    key: step,
    index: -1,
  })
  const [canAdvance, setCanAdvance] = React.useState(false)
  // NextButton registers its onAdvance here so Enter invokes the same fn.
  const buttonAdvanceRef = React.useRef<(() => void) | undefined>(undefined)
  const setAdvanceHandler = React.useCallback((fn: (() => void) | undefined) => {
    buttonAdvanceRef.current = fn
  }, [])
  const rootAdvanceRef = React.useRef<(() => void) | undefined>(onAdvance)
  const closeRef = React.useRef<(() => void) | undefined>(onClose)

  rootAdvanceRef.current = onAdvance
  closeRef.current = onClose

  // Count declared steps for default total.
  const declaredTotal = React.useMemo(() => {
    let n = 0
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && (child.type as { __wizardStep?: boolean })?.__wizardStep) {
        n++
      }
    })
    return n
  }, [children])

  const setActiveStepKey = React.useCallback((key: string, index: number) => {
    setActive((prev) => (prev.key === key && prev.index === index ? prev : { key, index }))
  }, [])

  // Keyboard: Enter (advance), Escape (close). Left/Right intentionally unbound.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (closeRef.current) {
          e.preventDefault()
          closeRef.current()
        }
        return
      }
      if (e.key === 'Enter') {
        // Don't hijack Enter inside multi-line inputs or when a button has focus.
        const target = e.target as HTMLElement | null
        if (target) {
          const tag = target.tagName
          if (tag === 'TEXTAREA') return
          if (tag === 'BUTTON') return
          // Respect contentEditable surfaces (prose editor, etc).
          if (target.isContentEditable) return
        }
        if (canAdvance) {
          const fn = buttonAdvanceRef.current ?? rootAdvanceRef.current
          if (fn) {
            e.preventDefault()
            fn()
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canAdvance])

  const value = React.useMemo<WizardContextValue>(
    () => ({
      stepKey: active.key,
      stepIndex: active.index,
      total: total ?? declaredTotal,
      onClose,
      setActiveStepKey,
    }),
    [active.key, active.index, total, declaredTotal, onClose, setActiveStepKey],
  )

  // Expose a setter for Step children via a nested provider below.
  return (
    <WizardContext.Provider value={value}>
      <WizardAdvanceRegistration setCanAdvance={setCanAdvance} setAdvanceHandler={setAdvanceHandler}>
        <div className={cn('flex flex-col h-full', className)} data-component-id="wizard-root">
          {React.Children.map(children, (child) => {
            if (!React.isValidElement(child)) return child
            const type = child.type as { __wizardStep?: boolean }
            if (type?.__wizardStep) {
              const stepKey = (child as React.ReactElement<{ stepKey?: string }>).props.stepKey
              const key = stepKey ?? (child.key ? String(child.key) : '')
              if (!key) {
                // Surface the misconfiguration early.
                if (typeof console !== 'undefined') {
                  console.warn('<Wizard.Step> requires a `key` or `stepKey` prop.')
                }
              }
              return key === step ? child : null
            }
            return child
          })}
        </div>
      </WizardAdvanceRegistration>
    </WizardContext.Provider>
  )
}

// ── canAdvance plumbing ────────────────────────────────
//
// NextButton registers a handler + its `disabled` state. Enter-to-advance then
// invokes the same function the button does. Kept in its own tiny context to
// avoid re-rendering the whole wizard on every keystroke.

const AdvanceRegistrationContext = React.createContext<{
  setCanAdvance: (v: boolean) => void
  setAdvanceHandler: (fn: (() => void) | undefined) => void
} | null>(null)

function WizardAdvanceRegistration({
  setCanAdvance,
  setAdvanceHandler,
  children,
}: {
  setCanAdvance: (v: boolean) => void
  setAdvanceHandler: (fn: (() => void) | undefined) => void
  children: React.ReactNode
}) {
  const value = React.useMemo(
    () => ({ setCanAdvance, setAdvanceHandler }),
    [setCanAdvance, setAdvanceHandler],
  )
  return (
    <AdvanceRegistrationContext.Provider value={value}>{children}</AdvanceRegistrationContext.Provider>
  )
}

// ── Step ───────────────────────────────────────────────

export interface WizardStepProps {
  /** Unique key matching the parent Wizard's `step` prop. */
  stepKey?: string
  /** 1-based index shown in the progress indicator. Falls back to auto-counting. */
  stepIndex?: number
  /** Hide the progress indicator entirely for this step (e.g. welcome, completion). */
  hideProgress?: boolean
  /**
   * How the step's contents should animate in.
   *  - `slide` (default): `wizard-step-enter` — a short translateY slide-up.
   *  - `fade`: `onboarding-fade-in` — opacity only. Use when the step already
   *     owns a rich staggered entrance (onboarding vignettes).
   *  - `none`: no wrapper animation.
   */
  transition?: 'slide' | 'fade' | 'none'
  className?: string
  children: React.ReactNode
}

function WizardStep({
  stepKey,
  stepIndex,
  hideProgress,
  transition = 'slide',
  className,
  children,
}: WizardStepProps) {
  const ctx = useWizardContext()
  React.useEffect(() => {
    if (stepKey) ctx.setActiveStepKey(stepKey, stepIndex ?? -1)
  }, [stepKey, stepIndex, ctx])

  const animation =
    transition === 'slide'
      ? 'motion-safe:animate-wizard-step-enter motion-reduce:animate-onboarding-fade-in'
      : transition === 'fade'
        ? 'animate-onboarding-fade-in'
        : ''

  return (
    <div
      key={stepKey ?? 'step'}
      className={cn(animation, 'flex flex-col min-h-0 flex-1', className)}
      data-wizard-step={stepKey}
      data-hide-progress={hideProgress ? '' : undefined}
    >
      {children}
    </div>
  )
}

;(WizardStep as unknown as { __wizardStep: boolean }).__wizardStep = true

// ── Header / Title / Description ───────────────────────

export interface WizardStepHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

function WizardStepHeader({ className, ...props }: WizardStepHeaderProps) {
  return <div className={cn('mb-8', className)} {...props} />
}

export interface WizardStepTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Display size. Onboarding uses `hero`, normal steps use `default`. */
  size?: 'default' | 'hero'
}

function WizardStepTitle({ size = 'default', className, ...props }: WizardStepTitleProps) {
  return (
    <h2
      className={cn(
        'font-display italic leading-tight',
        size === 'hero' ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl',
        className,
      )}
      {...props}
    />
  )
}

export interface WizardStepDescriptionProps extends React.ComponentProps<typeof Caption> {}

function WizardStepDescription({ className, size = 'sm', ...props }: WizardStepDescriptionProps) {
  return <Caption size={size} className={cn('mt-2', className)} {...props} />
}

// ── Body ───────────────────────────────────────────────

export interface WizardStepBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Scroll container width. Most steps use `narrow` (`max-w-xl`); onboarding
   * provider-select uses `wide` (`max-w-2xl`). Pass `none` to opt out entirely.
   */
  width?: 'narrow' | 'wide' | 'none'
  /** Give the body its own scroll instead of inheriting page scroll. */
  scroll?: boolean
}

function WizardStepBody({
  width = 'narrow',
  scroll = true,
  className,
  ...props
}: WizardStepBodyProps) {
  return (
    <div
      className={cn(scroll ? 'flex-1 overflow-auto' : undefined)}
      data-component-id="wizard-step-body"
    >
      <div
        className={cn(
          width === 'narrow' && 'max-w-xl mx-auto px-5 py-4 sm:px-8 sm:py-8',
          width === 'wide' && 'max-w-2xl mx-auto px-5 py-4 sm:px-8 sm:py-8',
          className,
        )}
        {...props}
      />
    </div>
  )
}

// ── Footer ─────────────────────────────────────────────

export interface WizardStepFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `divided` adds a hairline border above the footer; `clean` omits it. */
  variant?: 'divided' | 'clean'
  /** Layout: `spread` pushes back/next to edges; `center` centers everything. */
  align?: 'spread' | 'center'
}

function WizardStepFooter({
  variant = 'divided',
  align = 'spread',
  className,
  children,
  ...props
}: WizardStepFooterProps) {
  return (
    <div
      className={cn(
        'mt-10 pt-4 flex items-center gap-2',
        variant === 'divided' && 'border-t border-border/20',
        align === 'spread' ? 'justify-between' : 'justify-center',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// ── Back / Next buttons ────────────────────────────────

export interface WizardBackButtonProps extends React.ComponentProps<typeof Button> {
  /** Called when the button is clicked. */
  onBack?: () => void
  /** Shown next to the chevron. Defaults to `Back`. */
  children?: React.ReactNode
  /** Render a ghost button (default) or a quieter plain link. */
  tone?: 'ghost' | 'link'
}

function WizardBackButton({
  onBack,
  onClick,
  children = 'Back',
  tone = 'ghost',
  className,
  ...props
}: WizardBackButtonProps) {
  const handle = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    if (!e.defaultPrevented) onBack?.()
  }

  if (tone === 'link') {
    return (
      <button
        onClick={handle}
        className={cn(
          'text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1',
          className,
        )}
        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        <ChevronLeft className="size-3" /> {children}
      </button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('gap-1.5 text-muted-foreground', className)}
      onClick={handle}
      {...props}
    >
      <ChevronLeft className="size-3.5" /> {children}
    </Button>
  )
}

export interface WizardNextButtonProps extends React.ComponentProps<typeof Button> {
  /** Called when the button is clicked or Enter is pressed. */
  onAdvance?: () => void
  /** Button label. Falls back to `Continue`. */
  children?: React.ReactNode
  /** Show the chevron glyph. Defaults to `true`. */
  withChevron?: boolean
}

function WizardNextButton({
  onAdvance,
  onClick,
  children = 'Continue',
  withChevron = true,
  disabled,
  className,
  ...props
}: WizardNextButtonProps) {
  const reg = React.useContext(AdvanceRegistrationContext)

  // Tell the Wizard root whether Enter should advance, and wire the button's
  // handler so Enter and click invoke the same function.
  React.useEffect(() => {
    if (!reg) return
    reg.setCanAdvance(!disabled)
    reg.setAdvanceHandler(disabled ? undefined : onAdvance)
    return () => {
      reg.setCanAdvance(false)
      reg.setAdvanceHandler(undefined)
    }
  }, [reg, disabled, onAdvance])

  const handle = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    if (!e.defaultPrevented) onAdvance?.()
  }

  return (
    <Button size="sm" className={cn('gap-1.5', className)} disabled={disabled} onClick={handle} {...props}>
      {children}
      {withChevron && <ChevronRight className="size-3.5" />}
    </Button>
  )
}

// ── Skip ───────────────────────────────────────────────

export interface WizardSkipButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Label. Defaults to `Skip setup`. */
  children?: React.ReactNode
}

function WizardSkipButton({ className, children = 'Skip setup', ...props }: WizardSkipButtonProps) {
  return (
    <button
      className={cn(
        'text-[0.6875rem] text-muted-foreground hover:text-foreground transition-colors',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

// ── Progress ───────────────────────────────────────────

export interface WizardProgressProps {
  /** Current step index (1-based). Falls back to active step context. */
  current?: number
  /** Total steps. Falls back to context `total`. */
  total?: number
  className?: string
}

const ROMAN: Record<number, string> = {
  1: 'i',
  2: 'ii',
  3: 'iii',
  4: 'iv',
  5: 'v',
  6: 'vi',
  7: 'vii',
  8: 'viii',
  9: 'ix',
  10: 'x',
  11: 'xi',
  12: 'xii',
}

function toRoman(n: number): string {
  if (ROMAN[n]) return ROMAN[n]
  // Fallback: arabic. The wizard never has more than a dozen steps in practice.
  return String(n)
}

/**
 * Page-count progress indicator: a pair of lowercase Roman numerals in the
 * display serif, separated by a thin slash — like the front-matter pagination
 * of a printed book. No bars, no dots, no percents.
 */
function WizardProgress({ current, total, className }: WizardProgressProps) {
  const ctx = useWizardContext()
  const resolvedCurrent = current ?? (ctx.stepIndex >= 0 ? ctx.stepIndex + 1 : undefined)
  const resolvedTotal = total ?? ctx.total
  if (!resolvedCurrent || !resolvedTotal) return null
  return (
    <span
      className={cn(
        'font-display italic text-[0.8125rem] text-muted-foreground/70 tabular-nums tracking-wide',
        className,
      )}
      aria-label={`Step ${resolvedCurrent} of ${resolvedTotal}`}
    >
      {toRoman(resolvedCurrent)}
      <span className="mx-1 text-muted-foreground/40">/</span>
      {toRoman(resolvedTotal)}
    </span>
  )
}

// ── Toolbar ────────────────────────────────────────────
//
// A thin top strip holding progress on the left and skip on the right, mirroring
// the existing StoryWizard shell. Optional — steps may omit it or roll their own.

export interface WizardToolbarProps extends React.HTMLAttributes<HTMLDivElement> {}

function WizardToolbar({ className, children, ...props }: WizardToolbarProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-6 py-3 border-b border-border/15',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// ── Compound exports ───────────────────────────────────

Wizard.Step = WizardStep as React.FC<WizardStepProps>
Wizard.StepHeader = WizardStepHeader
Wizard.StepTitle = WizardStepTitle
Wizard.StepDescription = WizardStepDescription
Wizard.StepBody = WizardStepBody
Wizard.StepFooter = WizardStepFooter
Wizard.BackButton = WizardBackButton
Wizard.NextButton = WizardNextButton
Wizard.SkipButton = WizardSkipButton
Wizard.Progress = WizardProgress
Wizard.Toolbar = WizardToolbar
