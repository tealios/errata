import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  AgentConfigApplyResult,
  AgentConfigInspectResponse,
  AgentConfigPreview,
} from '@/lib/api/types'
import { parseGlobalPackId } from '@/lib/erratanet/pack-schema'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Loader2, Download, Code2, Check, ChevronRight } from 'lucide-react'
import {
  AgentConfigSelector,
  fullSelection,
  toSelectionPayload,
  selectionIsEmpty,
  selectedScripts,
  type AgentConfigSelectionState,
} from './AgentConfigSelector'

interface AgentConfigImportViewProps {
  id: string
  version?: string
  /** When present, the config can be applied to this story. */
  storyId?: string
}

/** Humanize an agent name for display ('character-chat' -> 'character chat'). */
function humanizeAgent(name: string): string {
  return name.replace(/[-_]+/g, ' ')
}

/**
 * The import flow for an `agent-config` pack: inspect (no side effects), show a
 * full preview of what changes, gate executable scripts behind explicit consent
 * (with the source shown), then apply to the current story and/or save as a
 * reusable preset.
 */
export function AgentConfigImportView({ id, version, storyId }: AgentConfigImportViewProps) {
  const qc = useQueryClient()
  const idParts = useMemo(() => parseGlobalPackId(id), [id])

  const { data, isLoading, error } = useQuery<AgentConfigInspectResponse>({
    queryKey: ['agent-config-inspect', id, version ?? 'latest'],
    queryFn: () => api.erratanet.agentConfig.inspect(id, version),
  })

  const [consent, setConsent] = useState(false)
  const [applyToStory, setApplyToStory] = useState<boolean>(!!storyId)
  const [savePreset, setSavePreset] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [result, setResult] = useState<{ applied?: AgentConfigApplyResult; presetId?: string } | null>(null)
  const [selection, setSelection] = useState<AgentConfigSelectionState>({
    agents: {},
    providers: [],
    modelRoles: [],
  })

  // Seed the selection (everything checked) once per pack ref. The inspect
  // query can refetch (e.g. on window focus while "latest" resolves to a newer
  // version); re-seeding then would silently discard the user's deselections.
  const seededKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const key = `${id}@${version ?? 'latest'}`
    if (data?.preview && seededKeyRef.current !== key) {
      seededKeyRef.current = key
      setSelection(fullSelection(data.preview))
    }
  }, [data, id, version])

  // Only the *selected* scripts gate consent; unpicking them clears it. The
  // hard gate applies only when applying to a story — saving a preset executes
  // nothing, and applying the preset later re-asks for consent.
  const scripts = data ? selectedScripts(selection, data.preview) : []
  const hasSelectedScripts = scripts.length > 0
  const needsConsent = hasSelectedScripts && applyToStory

  const applyMut = useMutation({
    mutationFn: async () => {
      return api.erratanet.agentConfig.apply({
        id,
        version,
        selection: toSelectionPayload(selection),
        consentToScripts: hasSelectedScripts && consent ? true : undefined,
        ...(applyToStory && storyId ? { applyToStoryId: storyId } : {}),
        ...(savePreset ? { savePreset: { name: presetName.trim() || data?.manifest.title || id } } : {}),
      })
    },
    onSuccess: (res) => {
      setResult({ applied: res.applied, presetId: res.presetId })
      qc.invalidateQueries({ queryKey: ['agent-presets'] })
      if (applyToStory && storyId) {
        qc.invalidateQueries({ queryKey: ['agent-blocks'] })
        qc.invalidateQueries({ queryKey: ['story', storyId] })
        qc.invalidateQueries({ queryKey: ['global-config'] })
      }
    },
  })

  const chooseAtLeastOne = applyToStory || savePreset
  const consentOk = !needsConsent || consent
  const canApply = chooseAtLeastOne && consentOk && !selectionIsEmpty(selection) && !applyMut.isPending && !result

  const handleLabel = data?.manifest.publisher ?? (idParts ? `@${idParts.handle}` : id)

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  if (error || !data || data.error) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive">
        {data?.error ?? (error instanceof Error ? error.message : 'Could not load this configuration.')}
      </div>
    )
  }

  const { manifest, summary, preview } = data

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          {/* Header */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-xl leading-tight">{manifest.title}</h3>
              <Badge variant="secondary" className="h-4 text-[0.625rem]">agent config</Badge>
              {summary.hasScripts && (
                <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 px-1.5 py-0.5 font-mono text-[0.625rem] lowercase tracking-wide text-amber-600 dark:text-amber-400">
                  <Code2 className="size-3" /> runs code
                </span>
              )}
            </div>
            <p className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">
              {handleLabel}{idParts ? `/${idParts.slug}` : ''} <span className="text-muted-foreground/70">v{manifest.version}</span>
            </p>
            {manifest.description && (
              <p className="mt-2 text-sm leading-relaxed text-foreground/80">{manifest.description}</p>
            )}
          </div>

          {result ? (
            <ApplyResultPanel result={result} />
          ) : (
            <>
              {/* Choose what to apply — down to individual agents and blocks. */}
              <div>
                <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                  Choose what to apply
                </span>
                <div className="mt-2">
                  <AgentConfigSelector preview={preview} value={selection} onChange={setSelection} />
                </div>
              </div>

              {/* Script consent — only the selected scripts. The review stays
                  visible for preset-only saves; the checkbox only gates an
                  apply-to-story. */}
              {hasSelectedScripts && (
                <ScriptConsent scripts={scripts} consent={consent} onConsent={setConsent} />
              )}

              {/* Targets */}
              <div className="space-y-2">
                <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">Apply</span>
                {storyId ? (
                  <TargetToggle
                    on={applyToStory}
                    onToggle={() => setApplyToStory((v) => !v)}
                    title="Apply to this story"
                    subtitle="Overlay these blocks and model assignments onto the open story."
                  />
                ) : (
                  <p className="rounded-md border border-border/30 px-3 py-2 text-xs text-muted-foreground">
                    Open a story to apply a config directly. You can still save it as a preset.
                  </p>
                )}
                <TargetToggle
                  on={savePreset}
                  onToggle={() => setSavePreset((v) => !v)}
                  title="Save as a preset"
                  subtitle="Keep it to reuse across any story later."
                />
                {savePreset && (
                  <Input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder={manifest.title || 'Preset name'}
                    className="h-9"
                  />
                )}
              </div>

              {applyMut.error && (
                <p className="text-xs text-destructive">
                  {applyMut.error instanceof Error ? applyMut.error.message : 'Apply failed.'}
                </p>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {!result && (
        <div className="flex items-center justify-end gap-2 border-t border-border/50 px-6 py-4">
          <Button onClick={() => applyMut.mutate()} disabled={!canApply} className="gap-1.5">
            {applyMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {applyToStory && savePreset ? 'Apply & save preset' : savePreset ? 'Save preset' : 'Apply to story'}
          </Button>
        </div>
      )}
    </>
  )
}

/** The executable-script gate: shows the selected scripts' source, then a consent box. */
function ScriptConsent({
  scripts,
  consent,
  onConsent,
}: {
  scripts: AgentConfigPreview['scripts']
  consent: boolean
  onConsent: (v: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-foreground">
        <Code2 className="size-4 text-amber-500" />
        This configuration runs code
      </p>
      <p className="mt-1 text-[0.6875rem] leading-snug text-muted-foreground">
        You&apos;ve selected {scripts.length} executable script {scripts.length === 1 ? 'block' : 'blocks'}.
        Read the source below before you apply it. Only adopt configs from authors you trust.
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-[0.6875rem] text-foreground/80 hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {open ? 'Hide' : 'Review'} script source
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {scripts.map((s, i) => (
            <div key={i} className="overflow-hidden rounded border border-border/40">
              <div className="flex items-baseline gap-2 border-b border-border/40 bg-muted/30 px-2.5 py-1">
                <span className="font-mono text-[0.625rem] text-muted-foreground">{humanizeAgent(s.agent)}</span>
                <span className="text-[0.6875rem]">{s.blockName}</span>
              </div>
              <pre className="max-h-48 overflow-auto p-2.5 font-mono text-[0.6875rem] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
                {s.content}
              </pre>
            </div>
          ))}
        </div>
      )}

      <label className="mt-3 flex items-start gap-2 text-[0.75rem]">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => onConsent(e.target.checked)}
          className="mt-0.5 size-3.5 accent-primary"
          data-component-id="agent-config-consent"
        />
        <span>I understand this configuration runs code, and I&apos;ve reviewed it.</span>
      </label>
    </div>
  )
}

function TargetToggle({
  on,
  onToggle,
  title,
  subtitle,
}: {
  on: boolean
  onToggle: () => void
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors',
        on ? 'border-primary/40 bg-primary/5' : 'border-border/40 hover:border-border',
      )}
    >
      <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
        {on ? <Check className="size-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[0.8125rem] leading-tight">{title}</span>
        <span className="block text-[0.6875rem] text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  )
}

function ApplyResultPanel({ result }: { result: { applied?: AgentConfigApplyResult; presetId?: string } }) {
  const a = result.applied
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2.5 text-sm text-foreground">
        <Check className="size-4 text-primary" />
        Done.
      </div>
      <ul className="space-y-1.5 text-[0.8125rem] text-muted-foreground">
        {a && a.agentsApplied.length > 0 && (
          <li>Applied blocks for <span className="text-foreground">{a.agentsApplied.map(humanizeAgent).join(', ')}</span>.</li>
        )}
        {a && a.modelRolesApplied.length > 0 && (
          <li>Set model assignments for <span className="text-foreground">{a.modelRolesApplied.map(humanizeAgent).join(', ')}</span>.</li>
        )}
        {result.presetId && <li>Saved as a preset you can reuse from any story.</li>}
      </ul>

      {a && a.modelRolesNeedingProvider.length > 0 && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[0.6875rem] text-muted-foreground">
          Some roles ({a.modelRolesNeedingProvider.map(humanizeAgent).join(', ')}) reference a provider you
          don&apos;t have yet. Add it in Settings → Providers and the model picks up automatically.
        </p>
      )}
      {a && a.suggestedProviders.length > 0 && (
        <p className="rounded-md border border-border/30 px-3 py-2 text-[0.6875rem] text-muted-foreground">
          This config was tuned for{' '}
          {a.suggestedProviders.map((p) => `${p.name} (${p.defaultModel})`).join(', ')}. Add your API key
          in Settings → Providers to match it.
        </p>
      )}
    </div>
  )
}
