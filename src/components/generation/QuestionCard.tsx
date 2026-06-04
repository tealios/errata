import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { HelpCircle } from 'lucide-react'
import type { ClarifyQuestion, Clarification } from '@/lib/api/types'

interface QuestionCardProps {
  questions: ClarifyQuestion[]
  onSubmit: (answers: Clarification[]) => void
  onCancel: () => void
  disabled?: boolean
}

interface AnswerState {
  selected: string[]
  other: string
  otherActive: boolean
}

function emptyAnswer(): AnswerState {
  return { selected: [], other: '', otherActive: false }
}

function deriveAnswer(q: ClarifyQuestion, a: AnswerState): string {
  const hasOptions = !!q.options && q.options.length > 0
  if (!hasOptions) return a.other.trim()
  const extra = a.otherActive && a.other.trim() ? [a.other.trim()] : []
  if (q.multiSelect) return [...a.selected, ...extra].join(', ')
  // single-select: an active "Other" entry wins, else the chosen label
  if (a.otherActive) return a.other.trim()
  return a.selected[0] ?? ''
}

export function QuestionCard({ questions, onSubmit, onCancel, disabled }: QuestionCardProps) {
  const [answers, setAnswers] = useState<AnswerState[]>(() => questions.map(emptyAnswer))

  const update = (i: number, patch: Partial<AnswerState>) =>
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))

  const toggleOption = (i: number, q: ClarifyQuestion, label: string) => {
    const a = answers[i]
    if (q.multiSelect) {
      const selected = a.selected.includes(label)
        ? a.selected.filter((l) => l !== label)
        : [...a.selected, label]
      update(i, { selected })
    } else {
      update(i, { selected: [label], otherActive: false })
    }
  }

  const toggleOther = (i: number, q: ClarifyQuestion) => {
    const a = answers[i]
    if (q.multiSelect) {
      update(i, { otherActive: !a.otherActive })
    } else {
      update(i, { otherActive: true, selected: [] })
    }
  }

  const complete = questions.every((q, i) => deriveAnswer(q, answers[i]).length > 0)

  const handleSubmit = () => {
    if (!complete || disabled) return
    onSubmit(questions.map((q, i) => ({ question: q.question, answer: deriveAnswer(q, answers[i]) })))
  }

  return (
    <div
      className="px-6 py-5 space-y-5 border-b border-border/40 bg-primary/[0.015]"
      data-component-id="clarify-question-card"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <HelpCircle className="size-3.5 text-primary/70" />
        <span className="font-sans text-[0.6875rem] uppercase tracking-[0.12em]">
          A few questions before writing
        </span>
      </div>

      <div className="space-y-6">
        {questions.map((q, i) => {
          const a = answers[i]
          const hasOptions = !!q.options && q.options.length > 0
          return (
            <div key={i} className="space-y-2.5" data-component-id="clarify-question">
              <div className="flex items-baseline gap-2.5">
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-sans text-[0.625rem] font-medium uppercase tracking-wide text-primary/80">
                  {q.header}
                </span>
                <p className="font-prose text-[0.9375rem] leading-snug text-foreground/90">
                  {q.question}
                </p>
              </div>

              {hasOptions && (
                <div className="flex flex-wrap gap-1.5">
                  {q.options!.map((opt) => {
                    const active = a.selected.includes(opt.label)
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        disabled={disabled}
                        aria-pressed={active}
                        title={opt.description}
                        onClick={() => toggleOption(i, q, opt.label)}
                        className={cn(
                          'rounded-md border px-2.5 py-1.5 text-left font-sans text-[0.8125rem] transition-all duration-200 disabled:opacity-40',
                          active
                            ? 'border-primary/40 bg-primary/[0.07] text-foreground'
                            : 'border-border/40 text-foreground/75 hover:border-primary/30 hover:bg-primary/[0.03]',
                        )}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={a.otherActive}
                    onClick={() => toggleOther(i, q)}
                    className={cn(
                      'rounded-md border px-2.5 py-1.5 font-sans text-[0.8125rem] italic transition-all duration-200 disabled:opacity-40',
                      a.otherActive
                        ? 'border-primary/40 bg-primary/[0.07] text-foreground'
                        : 'border-dashed border-border/50 text-muted-foreground hover:border-primary/30',
                    )}
                  >
                    Other…
                  </button>
                </div>
              )}

              {/* Free-text field: always for option-less questions, or when "Other" is active */}
              {(!hasOptions || a.otherActive) && (
                <textarea
                  value={a.other}
                  disabled={disabled}
                  onChange={(e) => update(i, { other: e.target.value })}
                  placeholder={hasOptions ? 'Your answer…' : 'Type your answer…'}
                  rows={hasOptions ? 1 : 2}
                  className="w-full resize-none rounded-md border border-border/40 bg-card/30 px-3 py-2 font-prose text-[0.875rem] leading-relaxed text-foreground outline-none transition-colors placeholder:italic placeholder:text-muted-foreground focus:border-primary/30 disabled:opacity-40"
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="font-sans text-[0.625rem] text-muted-foreground">
          Answers guide this passage only — nothing is saved.
        </span>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={onCancel}
            disabled={disabled}
            data-component-id="clarify-cancel"
          >
            Skip
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleSubmit}
            disabled={!complete || disabled}
            data-component-id="clarify-submit"
          >
            Answer &amp; continue
          </Button>
        </div>
      </div>
    </div>
  )
}
