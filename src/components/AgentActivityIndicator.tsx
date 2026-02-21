import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ActiveAgent } from '@/lib/api/agents'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { BookOpen, MessageSquare, Sparkles, Compass, Wand2, Bot } from 'lucide-react'

// ── Agent metadata ──────────────────────────────────────

interface AgentMeta {
  label: string
  action: string
  color: string
  glow: string
  icon: typeof Bot
}

const AGENT_META: Record<string, AgentMeta> = {
  'librarian.analyze': {
    label: 'Librarian',
    action: 'Analyzing',
    color: 'oklch(0.78 0.15 70)',
    glow: 'oklch(0.78 0.15 70 / 35%)',
    icon: BookOpen,
  },
  'librarian.refine': {
    label: 'Librarian',
    action: 'Refining',
    color: 'oklch(0.72 0.13 50)',
    glow: 'oklch(0.72 0.13 50 / 35%)',
    icon: Wand2,
  },
  'librarian.chat': {
    label: 'Librarian',
    action: 'Chatting',
    color: 'oklch(0.70 0.10 80)',
    glow: 'oklch(0.70 0.10 80 / 35%)',
    icon: MessageSquare,
  },
  'librarian.prose-transform': {
    label: 'Librarian',
    action: 'Transforming',
    color: 'oklch(0.70 0.12 135)',
    glow: 'oklch(0.70 0.12 135 / 35%)',
    icon: Wand2,
  },
  'character-chat.chat': {
    label: 'Character',
    action: 'Chatting',
    color: 'oklch(0.68 0.14 175)',
    glow: 'oklch(0.68 0.14 175 / 35%)',
    icon: MessageSquare,
  },
  'directions.suggest': {
    label: 'Directions',
    action: 'Suggesting',
    color: 'oklch(0.72 0.11 290)',
    glow: 'oklch(0.72 0.11 290 / 35%)',
    icon: Compass,
  },
  'generation': {
    label: 'Writer',
    action: 'Generating',
    color: 'oklch(0.74 0.12 25)',
    glow: 'oklch(0.74 0.12 25 / 35%)',
    icon: Sparkles,
  },
}

const DEFAULT_META: AgentMeta = {
  label: 'Agent',
  action: 'Working',
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
  const action = parts[1] ? titleCase(parts[1]) : 'Working'

  return { ...DEFAULT_META, label, action }
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
  const [, setTick] = useState(0) // force re-render for elapsed time
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

  // Tick elapsed time every second (only when wisps visible)
  useEffect(() => {
    if (wisps.length === 0) return
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [wisps.length > 0])

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
    <div className="absolute bottom-4 left-4 z-20 flex flex-col-reverse items-start gap-2.5 pointer-events-auto">
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
  const elapsed = formatElapsed(wisp.agent.startedAt)

  const animClass =
    wisp.phase === 'entering' ? 'animate-wisp-enter' :
    wisp.phase === 'exiting' ? 'animate-wisp-exit' :
    ''

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`group relative ${animClass}`}
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
            className="relative size-7 rounded-full flex items-center justify-center cursor-default animate-wisp-breathe animate-wisp-float animate-wisp-gradient"
            style={{
              '--wisp-color': meta.color,
              '--wisp-glow': meta.glow,
            } as React.CSSProperties}
          >
            <Icon className="size-3.5 text-white/90" strokeWidth={2.5} />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={16}
        className="px-3 py-2 max-w-48"
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium">
            {meta.label}
            <span className="text-foreground/50 mx-1">&middot;</span>
            {meta.action}
          </span>
          <span className="text-[10px] text-foreground/60 tabular-nums">{elapsed}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
