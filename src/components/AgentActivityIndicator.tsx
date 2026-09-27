import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ActiveAgent } from '@/lib/api/agents'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { BookOpen, MessageSquare, Sparkles, Compass, Wand2, Bot } from 'lucide-react'

// ── Agent metadata ──────────────────────────────────────

interface AgentMeta {
  label: string
  /** Rotating list of verbs the wisp cycles through while active. */
  actions: string[]
  color: string
  glow: string
  icon: typeof Bot
}

const AGENT_META: Record<string, AgentMeta> = {
  'librarian.analyze': {
    label: 'Librarian',
    actions: ['Reading', 'Annotating', 'Cross-referencing', 'Noting details'],
    color: 'oklch(0.78 0.15 70)',
    glow: 'oklch(0.78 0.15 70 / 35%)',
    icon: BookOpen,
  },
  'librarian.refine': {
    label: 'Librarian',
    actions: ['Refining', 'Polishing', 'Tightening a line', 'Re-phrasing'],
    color: 'oklch(0.72 0.13 50)',
    glow: 'oklch(0.72 0.13 50 / 35%)',
    icon: Wand2,
  },
  'librarian.chat': {
    label: 'Librarian',
    actions: ['Listening', 'Considering', 'Composing a reply'],
    color: 'oklch(0.70 0.10 80)',
    glow: 'oklch(0.70 0.10 80 / 35%)',
    icon: MessageSquare,
  },
  'librarian.optimize-character': {
    label: 'Librarian',
    actions: ['Sharpening', 'Consolidating', 'Clarifying'],
    color: 'oklch(0.75 0.13 60)',
    glow: 'oklch(0.75 0.13 60 / 35%)',
    icon: Sparkles,
  },
  'librarian.prose-transform': {
    label: 'Librarian',
    actions: ['Transforming', 'Rewriting', 'Re-voicing'],
    color: 'oklch(0.70 0.12 135)',
    glow: 'oklch(0.70 0.12 135 / 35%)',
    icon: Wand2,
  },
  'character-chat.chat': {
    label: 'Character',
    actions: ['Listening', 'Considering', 'Reaching for words'],
    color: 'oklch(0.68 0.14 175)',
    glow: 'oklch(0.68 0.14 175 / 35%)',
    icon: MessageSquare,
  },
  'directions.suggest': {
    label: 'Directions',
    actions: ['Plotting a path', 'Weighing options', 'Peering ahead'],
    color: 'oklch(0.72 0.11 290)',
    glow: 'oklch(0.72 0.11 290 / 35%)',
    icon: Compass,
  },
  'generation': {
    label: 'Writer',
    actions: ['Writing', 'Finding the next line', 'Listening to the page', 'Setting the scene'],
    color: 'oklch(0.74 0.12 25)',
    glow: 'oklch(0.74 0.12 25 / 35%)',
    icon: Sparkles,
  },
}

const DEFAULT_META: AgentMeta = {
  label: 'Agent',
  actions: ['Working'],
  color: 'oklch(0.65 0.08 240)',
  glow: 'oklch(0.65 0.08 240 / 35%)',
  icon: Bot,
}

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function getAgentMeta(agentName: string): AgentMeta {
  if (AGENT_META[agentName]) return AGENT_META[agentName]

  // Derive readable label/action from the agent name (e.g. "librarian.summarize" → "Librarian · Summarize")
  const parts = agentName.split('.')
  const label = titleCase(parts[0])
  const actions = [parts[1] ? titleCase(parts[1]) : 'Working']

  return { ...DEFAULT_META, label, actions }
}

// ── Wisp state management ───────────────────────────────

interface WispState {
  agent: ActiveAgent
  phase: 'entering' | 'active' | 'exiting'
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${minutes}m ${remaining}s`
}

// ── Component ───────────────────────────────────────────

export function AgentActivityIndicator({ storyId }: { storyId: string }) {
  const [wisps, setWisps] = useState<WispState[]>([])
  const prevIdsRef = useRef(new Set<string>())

  const { data: activeAgents } = useQuery({
    queryKey: ['active-agents', storyId],
    queryFn: () => api.agents.listActive(storyId),
    refetchInterval: 2_000,
  })

  // Diff active agents against current wisps
  useEffect(() => {
    if (!activeAgents) return

    const currentIds = new Set(activeAgents.map(a => a.id))
    const prevIds = prevIdsRef.current

    setWisps(prev => {
      const next = [...prev]

      // Mark removed agents as exiting
      for (const wisp of next) {
        if (wisp.phase !== 'exiting' && !currentIds.has(wisp.agent.id)) {
          wisp.phase = 'exiting'
        }
      }

      // Add new agents
      for (const agent of activeAgents) {
        if (!prevIds.has(agent.id) && !next.some(w => w.agent.id === agent.id)) {
          next.push({ agent, phase: 'entering' })
        }
      }

      return next
    })

    prevIdsRef.current = currentIds
  }, [activeAgents])

  const handleAnimationEnd = useCallback((id: string, phase: 'entering' | 'exiting') => {
    setWisps(prev => {
      if (phase === 'entering') {
        return prev.map(w => w.agent.id === id ? { ...w, phase: 'active' } : w)
      }
      if (phase === 'exiting') {
        return prev.filter(w => w.agent.id !== id)
      }
      return prev
    })
  }, [])

  if (wisps.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Agent activity"
      className="absolute z-20 flex flex-col items-start gap-2.5 pointer-events-auto top-16 left-3 md:top-auto md:flex-col-reverse md:bottom-4 md:left-4"
    >
      {wisps.map((wisp, i) => (
        <Wisp
          key={wisp.agent.id}
          wisp={wisp}
          index={i}
          onAnimationEnd={handleAnimationEnd}
        />
      ))}
    </div>
  )
}

// ── Elapsed time (isolated re-render) ───────────────────

function Elapsed({ startedAt }: { startedAt: string }) {
  const [text, setText] = useState(() => formatElapsed(startedAt))
  useEffect(() => {
    const id = setInterval(() => setText(formatElapsed(startedAt)), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return <span className="text-[0.625rem] text-foreground/50 tabular-nums">{text}</span>
}

// ── Individual wisp ─────────────────────────────────────

function Wisp({
  wisp,
  index,
  onAnimationEnd,
}: {
  wisp: WispState
  index: number
  onAnimationEnd: (id: string, phase: 'entering' | 'exiting') => void
}) {
  const meta = getAgentMeta(wisp.agent.agentName)
  const Icon = meta.icon

  // Each wisp rotates through its vocabulary at a slightly randomized cadence,
  // so multiple wisps don't tick in sync — gives each one a life of its own.
  const [actionIndex, setActionIndex] = useState(() =>
    Math.floor(Math.random() * meta.actions.length),
  )
  useEffect(() => {
    if (meta.actions.length <= 1) return
    const interval = 3800 + Math.floor(Math.random() * 1800)
    const id = setInterval(() => {
      setActionIndex(i => (i + 1) % meta.actions.length)
    }, interval)
    return () => clearInterval(id)
  }, [meta.actions.length])
  const currentAction = meta.actions[actionIndex]

  const animClass =
    wisp.phase === 'entering' ? 'animate-wisp-enter' :
    wisp.phase === 'exiting' ? 'animate-wisp-exit' :
    ''

  const accessibleName = `${meta.label}, ${currentAction.toLowerCase()}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Button wrapper enlarges the hit area to 44×44 while keeping the
            visual orb at 28px, satisfies keyboard/focus, and carries the
            accessible name for screen readers. */}
        <button
          type="button"
          aria-label={accessibleName}
          className={`group relative p-2 -m-2 rounded-full transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:hover:scale-100 ${animClass}`}
          style={{
            animationDelay: wisp.phase === 'entering' ? `${index * 80}ms` : undefined,
          }}
          onAnimationEnd={() => {
            if (wisp.phase === 'entering' || wisp.phase === 'exiting') {
              onAnimationEnd(wisp.agent.id, wisp.phase)
            }
          }}
        >
          {/* Main orb with animated gradient */}
          <div
            className="relative size-7 rounded-full flex items-center justify-center animate-wisp-breathe animate-wisp-float animate-wisp-gradient transition-[filter] duration-200 group-hover:brightness-110"
            style={{
              '--wisp-color': meta.color,
              '--wisp-glow': meta.glow,
            } as React.CSSProperties}
          >
            <Icon
              aria-hidden="true"
              className="size-3.5 text-white drop-shadow-[0_0_3px_rgb(0_0_0_/_35%)]"
              strokeWidth={2.5}
            />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={16}
        className="px-3 py-2 max-w-56"
      >
        <div className="flex flex-col gap-1">
          <span
            key={currentAction}
            className="font-display italic text-sm leading-snug animate-onboarding-fade-in"
          >
            The {meta.label.toLowerCase()} <span className="text-foreground/40">—</span> {currentAction.toLowerCase()}
          </span>
          <Elapsed startedAt={wisp.agent.startedAt} />
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
