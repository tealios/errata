import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

export interface HelpState {
  open: boolean
  /** e.g. 'generation', 'fragments' */
  section: string | null
  /** e.g. 'built-in-tools' — the part after # */
  anchor: string | null
  /** Monotonic counter to force scroll even when navigating to the same anchor */
  seq: number
}

interface HelpContextValue {
  state: HelpState
  /** Open help to a topic. Supports 'section#anchor' format. */
  openHelp: (topic?: string) => void
  closeHelp: () => void
}

const HelpContext = createContext<HelpContextValue | null>(null)

function parseTopic(topic?: string): { section: string | null; anchor: string | null } {
  if (!topic) return { section: null, anchor: null }
  const hashIdx = topic.indexOf('#')
  if (hashIdx === -1) return { section: topic, anchor: null }
  return {
    section: topic.slice(0, hashIdx) || null,
    anchor: topic.slice(hashIdx + 1) || null,
  }
}

export function HelpProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HelpState>({
    open: false,
    section: null,
    anchor: null,
    seq: 0,
  })

  const openHelp = useCallback((topic?: string) => {
    const { section, anchor } = parseTopic(topic)
    setState((prev) => ({ open: true, section, anchor, seq: prev.seq + 1 }))
  }, [])

  const closeHelp = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  // Close on Escape
  useEffect(() => {
    if (!state.open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeHelp()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [state.open, closeHelp])

  return (
    <HelpContext.Provider value={{ state, openHelp, closeHelp }}>
      {children}
    </HelpContext.Provider>
  )
}

export function useHelp() {
  const ctx = useContext(HelpContext)
  if (!ctx) throw new Error('useHelp must be used within a HelpProvider')
  return ctx
}
