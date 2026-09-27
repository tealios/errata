import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/**
 * True on touch-first devices. Used to keep custom floating UI out of the way
 * of the OS text-selection menu, which Android and iOS draw above a selection.
 */
export function useIsCoarsePointer() {
  const [coarse, setCoarse] = React.useState(false)

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const mql = window.matchMedia("(pointer: coarse)")
    const onChange = () => setCoarse(mql.matches)
    mql.addEventListener("change", onChange)
    setCoarse(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return coarse
}
