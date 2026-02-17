import { createContext, useContext, useState, useEffect, useCallback } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'errata-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return 'dark'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  const applyTheme = useCallback((t: Theme) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme, applyTheme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    localStorage.setItem(STORAGE_KEY, t)
  }, [])

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

// --- App preferences (simple localStorage booleans) ---

function useBoolPref(key: string, defaultValue: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return defaultValue
    const stored = localStorage.getItem(key)
    return stored === null ? defaultValue : stored === 'true'
  })

  const set = useCallback((v: boolean) => {
    setValue(v)
    localStorage.setItem(key, String(v))
  }, [key])

  return [value, set]
}

export function useQuickSwitch() {
  return useBoolPref('errata-quick-switch', false)
}

// --- Prose width preference ---

export type ProseWidth = 'narrow' | 'medium' | 'wide' | 'full'

export const PROSE_WIDTH_VALUES: Record<ProseWidth, string> = {
  narrow: '38rem',
  medium: '52rem',
  wide: '68rem',
  full: '100%',
}

const PROSE_WIDTH_EVENT = 'errata-prose-width-change'

export function useProseWidth(): [ProseWidth, (v: ProseWidth) => void] {
  const [value, setValue] = useState<ProseWidth>(() => {
    if (typeof window === 'undefined') return 'narrow'
    const stored = localStorage.getItem('errata-prose-width')
    if (stored && stored in PROSE_WIDTH_VALUES) return stored as ProseWidth
    return 'narrow'
  })

  useEffect(() => {
    const handler = (e: Event) => setValue((e as CustomEvent<ProseWidth>).detail)
    window.addEventListener(PROSE_WIDTH_EVENT, handler)
    return () => window.removeEventListener(PROSE_WIDTH_EVENT, handler)
  }, [])

  const set = useCallback((v: ProseWidth) => {
    setValue(v)
    localStorage.setItem('errata-prose-width', v)
    window.dispatchEvent(new CustomEvent(PROSE_WIDTH_EVENT, { detail: v }))
  }, [])

  return [value, set]
}

// --- Prose font size preference ---

export type ProseFontSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export const PROSE_FONT_SIZE_VALUES: Record<ProseFontSize, string> = {
  xs: '0.9375rem',   // 15px
  sm: '1rem',        // 16px
  md: '1.0625rem',   // 17px (default)
  lg: '1.1875rem',   // 19px
  xl: '1.3125rem',   // 21px
}

export const PROSE_FONT_SIZE_LABELS: Record<ProseFontSize, string> = {
  xs: 'XS',
  sm: 'S',
  md: 'M',
  lg: 'L',
  xl: 'XL',
}

const PROSE_FONT_SIZE_KEY = 'errata-prose-font-size'
const PROSE_FONT_SIZE_EVENT = 'errata-prose-font-size-change'

function applyProseFontSize(size: ProseFontSize) {
  if (size === 'md') {
    document.documentElement.style.removeProperty('--prose-font-size')
  } else {
    document.documentElement.style.setProperty('--prose-font-size', PROSE_FONT_SIZE_VALUES[size])
  }
}

export function useProseFontSize(): [ProseFontSize, (v: ProseFontSize) => void] {
  const [value, setValue] = useState<ProseFontSize>(() => {
    if (typeof window === 'undefined') return 'md'
    const stored = localStorage.getItem(PROSE_FONT_SIZE_KEY)
    if (stored && stored in PROSE_FONT_SIZE_VALUES) return stored as ProseFontSize
    return 'md'
  })

  useEffect(() => {
    applyProseFontSize(value)
  }, [value])

  useEffect(() => {
    const handler = (e: Event) => setValue((e as CustomEvent<ProseFontSize>).detail)
    window.addEventListener(PROSE_FONT_SIZE_EVENT, handler)
    return () => window.removeEventListener(PROSE_FONT_SIZE_EVENT, handler)
  }, [])

  const set = useCallback((v: ProseFontSize) => {
    setValue(v)
    localStorage.setItem(PROSE_FONT_SIZE_KEY, v)
    window.dispatchEvent(new CustomEvent(PROSE_FONT_SIZE_EVENT, { detail: v }))
  }, [])

  return [value, set]
}

// --- Font preferences ---

export type FontRole = 'display' | 'prose' | 'sans' | 'mono'

export interface FontOption {
  name: string
  fallback: string
}

export const FONT_CATALOGUE: Record<FontRole, FontOption[]> = {
  display: [
    { name: 'Instrument Serif', fallback: 'Georgia, serif' },
    { name: 'Playfair Display', fallback: 'Georgia, serif' },
    { name: 'Cormorant Garamond', fallback: 'Georgia, serif' },
  ],
  prose: [
    { name: 'Newsreader', fallback: 'Georgia, serif' },
    { name: 'Literata', fallback: 'Georgia, serif' },
    { name: 'Lora', fallback: 'Georgia, serif' },
    { name: 'EB Garamond', fallback: 'Georgia, serif' },
  ],
  sans: [
    { name: 'Outfit', fallback: '-apple-system, BlinkMacSystemFont, sans-serif' },
    { name: 'DM Sans', fallback: '-apple-system, BlinkMacSystemFont, sans-serif' },
    { name: 'Plus Jakarta Sans', fallback: '-apple-system, BlinkMacSystemFont, sans-serif' },
  ],
  mono: [
    { name: 'JetBrains Mono', fallback: '"Fira Code", Menlo, monospace' },
    { name: 'Fira Code', fallback: '"JetBrains Mono", Menlo, monospace' },
    { name: 'Source Code Pro', fallback: 'Menlo, monospace' },
  ],
}

export const DEFAULT_FONTS: Record<FontRole, string> = {
  display: 'Instrument Serif',
  prose: 'Newsreader',
  sans: 'Outfit',
  mono: 'JetBrains Mono',
}

export type FontPreferences = Partial<Record<FontRole, string>>

const FONTS_KEY = 'errata-fonts'

function getFontCssValue(role: FontRole, name: string): string {
  const catalogue = FONT_CATALOGUE[role]
  const option = catalogue.find(o => o.name === name) ?? catalogue[0]
  return `"${option.name}", ${option.fallback}`
}

function applyFontPreferences(prefs: FontPreferences) {
  const style = document.documentElement.style
  for (const role of ['display', 'prose', 'sans', 'mono'] as FontRole[]) {
    const name = prefs[role]
    if (name && name !== DEFAULT_FONTS[role]) {
      style.setProperty(`--font-${role}`, getFontCssValue(role, name))
    } else {
      style.removeProperty(`--font-${role}`)
    }
  }
}

function getInitialFontPreferences(): FontPreferences {
  if (typeof window === 'undefined') return {}
  try {
    const stored = localStorage.getItem(FONTS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

export function useFontPreferences(): [FontPreferences, (role: FontRole, name: string) => void, () => void] {
  const [prefs, setPrefs] = useState<FontPreferences>(getInitialFontPreferences)

  useEffect(() => {
    applyFontPreferences(prefs)
  }, [prefs])

  const setFont = useCallback((role: FontRole, name: string) => {
    setPrefs(prev => {
      const next = { ...prev }
      if (name === DEFAULT_FONTS[role]) {
        delete next[role]
      } else {
        next[role] = name
      }
      localStorage.setItem(FONTS_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const resetFonts = useCallback(() => {
    setPrefs({})
    localStorage.removeItem(FONTS_KEY)
    applyFontPreferences({})
  }, [])

  return [prefs, setFont, resetFonts]
}

export function getActiveFont(role: FontRole, prefs: FontPreferences): string {
  return prefs[role] ?? DEFAULT_FONTS[role]
}
