import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from '@/components/ui/chain-of-thought'
import { Loader2, Brain, Wrench, CheckCircle2 } from 'lucide-react'
import { type ThoughtStep } from './InlineGenerationInput'

function formatToolName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

function summarizeToolResult(result: unknown): string {
  if (result == null) return 'Done'
  if (typeof result === 'string') return result.length > 100 ? result.slice(0, 100) + '...' : result
  const r = result as Record<string, unknown>
  if (r.error) return `Error: ${r.error}`
  if (r.ok === true) return 'Success'
  if (r.name && r.type) return `${r.name} (${r.type})`
  if (r.name) return String(r.name)
  if (Array.isArray(r.fragments)) return `${r.fragments.length} fragment${r.fragments.length === 1 ? '' : 's'}`
  if (Array.isArray(r.matches)) return `${r.matches.length} match${r.matches.length === 1 ? '' : 'es'}`
  if (Array.isArray(result)) return `${result.length} item${result.length === 1 ? '' : 's'}`
  return 'Done'
}

export function GenerationThoughts({
  steps,
  streaming,
  hasText,
}: {
  steps: ThoughtStep[]
  streaming: boolean
  hasText: boolean
}) {
  // Determine if reasoning is still actively streaming (no text yet, last step is reasoning)
  const lastStep = steps[steps.length - 1]
  const isThinking = streaming && !hasText && lastStep?.type === 'reasoning'


  return (
    <div className="mb-4" data-component-id="generation-thoughts-root">
      <ChainOfThought defaultOpen={true}>
        <ChainOfThoughtContent>
          {steps.map((step, i) => {
            if (step.type === 'reasoning') {
              return (
                <ChainOfThoughtStep
                  key={`reasoning-${i}`}
                  icon={Brain}
                  label="Thinking"
                  status={isThinking && i === steps.length - 1 ? 'active' : 'complete'}
                >
                  <div className="text-[10px] text-muted-foreground/40 italic font-mono whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-y-auto">
                    {step.text}
                  </div>
                </ChainOfThoughtStep>
              )
            }
            if (step.type === 'tool-call') {
              // Check if we have a matching result
              const result = steps.find(
                (s) => s.type === 'tool-result' && s.id === step.id,
              ) as Extract<ThoughtStep, { type: 'tool-result' }> | undefined
              const isActive = streaming && !result

              return (
                <ChainOfThoughtStep
                  key={`tool-${step.id}`}
                  icon={isActive ? Loader2 : result ? CheckCircle2 : Wrench}
                  label={
                    <span className="font-mono text-xs">
                      {formatToolName(step.toolName)}
                      {Object.keys(step.args).length > 0 && (
                        <span className="text-muted-foreground/40 ml-1.5">
                          {Object.entries(step.args)
                            .slice(0, 2)
                            .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v).slice(0, 30)}`)
                            .join(', ')}
                        </span>
                      )}
                    </span>
                  }
                  status={isActive ? 'active' : 'complete'}
                  description={
                    result
                      ? summarizeToolResult(result.result)
                      : undefined
                  }
                />
              )
            }
            // tool-result steps are rendered inline with their tool-call
            return null
          })}
        </ChainOfThoughtContent>
      </ChainOfThought>
    </div>
  )
}
