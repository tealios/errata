import { createContext, useContext, useState, useEffect, useCallback } from 'react'

type Theme = 'light' | 'dark' | 'high-contrast'

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
  if (stored === 'light' || stored === 'dark' || stored === 'high-contrast') return stored
  return 'dark'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  const applyTheme = useCallback((t: Theme) => {
    const root = document.documentElement
    root.classList.toggle('dark', t === 'dark')
    root.classList.toggle('high-contrast', t === 'high-contrast')
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme, applyTheme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    localStorage.setItem(STORAGE_KEY, t)
  }, [])

  const toggle = useCallback(() => {
    const cycle: Record<Theme, Theme> = {
      dark: 'light',
      light: 'high-contrast',
      'high-contrast': 'dark',
    }
    setTheme(cycle[theme])
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

export function useCharacterMentions() {
  return useBoolPref('errata-character-mentions', false)
}

const TIMELINE_BAR_KEY = 'errata-timeline-bar'
const TIMELINE_BAR_EVENT = 'errata-timeline-bar-change'

export function useTimelineBar(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem(TIMELINE_BAR_KEY)
    return stored === null ? true : stored === 'true'
  })

  useEffect(() => {
    const handler = (e: Event) => setValue((e as CustomEvent<boolean>).detail)
    window.addEventListener(TIMELINE_BAR_EVENT, handler)
    return () => window.removeEventListener(TIMELINE_BAR_EVENT, handler)
  }, [])

  const set = useCallback((v: boolean) => {
    setValue(v)
    localStorage.setItem(TIMELINE_BAR_KEY, String(v))
    window.dispatchEvent(new CustomEvent(TIMELINE_BAR_EVENT, { detail: v }))
  }, [])

  return [value, set]
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

// --- UI font size preference (root scaling) ---

export type UiFontSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export const UI_FONT_SIZE_VALUES: Record<UiFontSize, number> = {
  xs: 13,
  sm: 14.5,
  md: 16,   // browser default — no override
  lg: 17.5,
  xl: 19,
}

export const UI_FONT_SIZE_LABELS: Record<UiFontSize, string> = {
  xs: 'XS',
  sm: 'S',
  md: 'M',
  lg: 'L',
  xl: 'XL',
}

const UI_FONT_SIZE_KEY = 'errata-ui-font-size'
const UI_FONT_SIZE_EVENT = 'errata-ui-font-size-change'

function applyUiFontSize(size: UiFontSize) {
  if (typeof document === 'undefined') return
  if (size === 'md') {
    document.documentElement.style.removeProperty('font-size')
  } else {
    document.documentElement.style.setProperty('font-size', `${UI_FONT_SIZE_VALUES[size]}px`)
  }
}

// Apply saved preference eagerly on module load (prevents FOUC)
if (typeof window !== 'undefined') {
  const _stored = localStorage.getItem(UI_FONT_SIZE_KEY)
  if (_stored && _stored in UI_FONT_SIZE_VALUES) {
    applyUiFontSize(_stored as UiFontSize)
  }
}

export function useUiFontSize(): [UiFontSize, (v: UiFontSize) => void] {
  const [value, setValue] = useState<UiFontSize>(() => {
    if (typeof window === 'undefined') return 'md'
    const stored = localStorage.getItem(UI_FONT_SIZE_KEY)
    if (stored && stored in UI_FONT_SIZE_VALUES) return stored as UiFontSize
    return 'md'
  })

  useEffect(() => {
    applyUiFontSize(value)
  }, [value])

  useEffect(() => {
    const handler = (e: Event) => setValue((e as CustomEvent<UiFontSize>).detail)
    window.addEventListener(UI_FONT_SIZE_EVENT, handler)
    return () => window.removeEventListener(UI_FONT_SIZE_EVENT, handler)
  }, [])

  const set = useCallback((v: UiFontSize) => {
    setValue(v)
    localStorage.setItem(UI_FONT_SIZE_KEY, v)
    window.dispatchEvent(new CustomEvent(UI_FONT_SIZE_EVENT, { detail: v }))
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
  tag?: string
}

export const FONT_CATALOGUE: Record<FontRole, FontOption[]> = {
  display: [
    { name: 'Instrument Serif', fallback: 'Georgia, serif' },
    { name: 'Playfair Display', fallback: 'Georgia, serif' },
    { name: 'Cormorant Garamond', fallback: 'Georgia, serif' },
    { name: 'Lexend', fallback: '-apple-system, BlinkMacSystemFont, sans-serif', tag: 'high-visibility' },
    { name: 'Atkinson Hyperlegible Next', fallback: '-apple-system, BlinkMacSystemFont, sans-serif', tag: 'high-visibility' },
  ],
  prose: [
    { name: 'Newsreader', fallback: 'Georgia, serif' },
    { name: 'Literata', fallback: 'Georgia, serif' },
    { name: 'Lora', fallback: 'Georgia, serif' },
    { name: 'EB Garamond', fallback: 'Georgia, serif' },
    { name: 'Lexend', fallback: '-apple-system, BlinkMacSystemFont, sans-serif', tag: 'high-visibility' },
    { name: 'Atkinson Hyperlegible Next', fallback: '-apple-system, BlinkMacSystemFont, sans-serif', tag: 'high-visibility' },
  ],
  sans: [
    { name: 'Outfit', fallback: '-apple-system, BlinkMacSystemFont, sans-serif' },
    { name: 'DM Sans', fallback: '-apple-system, BlinkMacSystemFont, sans-serif' },
    { name: 'Plus Jakarta Sans', fallback: '-apple-system, BlinkMacSystemFont, sans-serif' },
    { name: 'Lexend', fallback: '-apple-system, BlinkMacSystemFont, sans-serif', tag: 'high-visibility' },
    { name: 'Atkinson Hyperlegible Next', fallback: '-apple-system, BlinkMacSystemFont, sans-serif', tag: 'high-visibility' },
  ],
  mono: [
    { name: 'JetBrains Mono', fallback: '"Fira Code", Menlo, monospace' },
    { name: 'Fira Code', fallback: '"JetBrains Mono", Menlo, monospace' },
    { name: 'Source Code Pro', fallback: 'Menlo, monospace' },
    { name: 'Atkinson Hyperlegible Mono', fallback: 'Menlo, monospace', tag: 'high-visibility' },
  ],
}

export const DEFAULT_FONTS: Record<FontRole, string> = {
  display: 'Instrument Serif',
  prose: 'Newsreader',
  sans: 'Outfit',
  mono: 'JetBrains Mono',
}

export type FontPreferences = Partial<Record<FontRole, string>>

const FONT_SPECS: Record<string, string> = {
  'Instrument Serif': 'ital@0;1',
  'Playfair Display': 'ital,wght@0,400..900;1,400..900',
  'Cormorant Garamond': 'ital,wght@0,300..700;1,300..700',
  'Newsreader': 'ital,opsz,wght@0,6..72,200..800;1,6..72,200..800',
  'Literata': 'ital,opsz,wght@0,7..72,200..900;1,7..72,200..900',
  'Lora': 'ital,wght@0,400..700;1,400..700',
  'EB Garamond': 'ital,wght@0,400..800;1,400..800',
  'Outfit': 'wght@300..700',
  'DM Sans': 'wght@300..700',
  'Plus Jakarta Sans': 'wght@300..700',
  'Lexend': 'wght@300..700',
  'Atkinson Hyperlegible Next': 'ital,wght@0,400..700;1,400..700',
  'Atkinson Hyperlegible Mono': 'ital,wght@0,400..700;1,400..700',
  'JetBrains Mono': 'wght@400;500',
  'Fira Code': 'wght@400;500',
  'Source Code Pro': 'wght@400;500',
}

let fullCatalogueLoaded = false

/**
 * Load the full Google Fonts catalogue (all 13 families).
 * Skips fonts already loaded at startup. Safe to call multiple times.
 */
export function loadFullFontCatalogue() {
  if (fullCatalogueLoaded) return
  fullCatalogueLoaded = true

  const alreadyLoaded: Set<string> =
    (window as unknown as { __errata_loaded_fonts?: Set<string> }).__errata_loaded_fonts ?? new Set()

  const missing = Object.keys(FONT_SPECS).filter(name => !alreadyLoaded.has(name))
  if (missing.length === 0) return

  const families = missing.map(
    name => `family=${name.replace(/ /g, '+')}:${FONT_SPECS[name]}`
  )
  const url = `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  document.head.appendChild(link)
}

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

// --- Custom CSS preference ---

const CUSTOM_CSS_KEY = 'errata-custom-css'
const CUSTOM_CSS_ENABLED_KEY = 'errata-custom-css-enabled'
const CUSTOM_CSS_EVENT = 'errata-custom-css-change'

interface CustomCssChangeDetail {
  css?: string
  enabled?: boolean
}

function getInitialCustomCss(): string {
  if (typeof window === 'undefined') return ''
  try {
    const stored = localStorage.getItem(CUSTOM_CSS_KEY)
    return stored ?? ''
  } catch {
    return ''
  }
}

function getInitialCustomCssEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const stored = localStorage.getItem(CUSTOM_CSS_ENABLED_KEY)
    return stored === 'true'
  } catch {
    return false
  }
}

export function useCustomCss(): [string, boolean, (css: string) => void, (enabled: boolean) => void] {
  const [css, setCssState] = useState<string>(getInitialCustomCss)
  const [enabled, setEnabledState] = useState<boolean>(getInitialCustomCssEnabled)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<CustomCssChangeDetail>).detail
      if (typeof detail.css === 'string') setCssState(detail.css)
      if (typeof detail.enabled === 'boolean') setEnabledState(detail.enabled)
    }
    window.addEventListener(CUSTOM_CSS_EVENT, handler)
    return () => window.removeEventListener(CUSTOM_CSS_EVENT, handler)
  }, [])

  const setCss = useCallback((newCss: string) => {
    setCssState(newCss)
    localStorage.setItem(CUSTOM_CSS_KEY, newCss)
    window.dispatchEvent(new CustomEvent<CustomCssChangeDetail>(CUSTOM_CSS_EVENT, { detail: { css: newCss } }))
  }, [])

  const setEnabled = useCallback((isEnabled: boolean) => {
    setEnabledState(isEnabled)
    localStorage.setItem(CUSTOM_CSS_ENABLED_KEY, String(isEnabled))
    window.dispatchEvent(new CustomEvent<CustomCssChangeDetail>(CUSTOM_CSS_EVENT, { detail: { enabled: isEnabled } }))
  }, [])

  return [css, enabled, setCss, setEnabled]
}

// --- Writing transforms preference ---

export interface WritingTransform {
  id: string
  label: string
  instruction: string
  enabled: boolean
}

const WRITING_TRANSFORMS_KEY = 'errata-writing-transforms'
const WRITING_TRANSFORMS_EVENT = 'errata-writing-transforms-change'

const DEFAULT_TRANSFORMS: WritingTransform[] = [
  { id: 'inner-thoughts', label: 'Add inner thoughts', instruction: 'Add inner thoughts and internal monologue to the selected text, revealing what the character is thinking and feeling beneath the surface.', enabled: true },
  { id: 'to-dialogue', label: 'Convert to dialogue', instruction: 'Convert the selected text into dialogue between characters, preserving the narrative information through spoken words and natural conversation.', enabled: true },
  { id: 'active-voice', label: 'Passive to active voice', instruction: 'Convert passive voice constructions in the selected text to active voice for more direct, engaging prose.', enabled: true },
  { id: 'different-words', label: 'Use different words', instruction: 'Rephrase the selected text using different vocabulary and sentence structures while preserving the exact same meaning and tone.', enabled: true },
  { id: 'show-dont-tell', label: "Show, don't tell", instruction: "Rewrite the selected text to show through action, sensory detail, and dialogue rather than telling. Replace statements about emotions or states with concrete scenes that let the reader experience them.", enabled: true },
  { id: 'more-emotion', label: 'Show more emotion', instruction: 'Enhance the emotional depth of the selected text by adding visceral reactions, body language, sensory details, and internal responses that convey feeling without stating it directly.', enabled: true },
  { id: 'fix-transitions', label: 'Fix transitions', instruction: 'Improve the transitions in the selected text to create smoother flow between ideas, scenes, or paragraphs. Ensure continuity and natural pacing.', enabled: true },
  { id: 'remove-llmism', label: 'Remove LLM-isms', instruction: 'Identify and remove common language patterns that reveal the text was generated by a language model, such as "it does just x, it\'s y".', enabled: true },
]

function getInitialWritingTransforms(): WritingTransform[] {
  if (typeof window === 'undefined') return DEFAULT_TRANSFORMS
  try {
    const stored = localStorage.getItem(WRITING_TRANSFORMS_KEY)
    if (!stored) return DEFAULT_TRANSFORMS
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : DEFAULT_TRANSFORMS
  } catch {
    return DEFAULT_TRANSFORMS
  }
}

export function useWritingTransforms(): [WritingTransform[], (transforms: WritingTransform[]) => void, () => void] {
  const [transforms, setTransformsState] = useState<WritingTransform[]>(getInitialWritingTransforms)

  useEffect(() => {
    const handler = (e: Event) => setTransformsState((e as CustomEvent<WritingTransform[]>).detail)
    window.addEventListener(WRITING_TRANSFORMS_EVENT, handler)
    return () => window.removeEventListener(WRITING_TRANSFORMS_EVENT, handler)
  }, [])

  const setTransforms = useCallback((next: WritingTransform[]) => {
    setTransformsState(next)
    localStorage.setItem(WRITING_TRANSFORMS_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(WRITING_TRANSFORMS_EVENT, { detail: next }))
  }, [])

  const resetToDefaults = useCallback(() => {
    setTransformsState(DEFAULT_TRANSFORMS)
    localStorage.setItem(WRITING_TRANSFORMS_KEY, JSON.stringify(DEFAULT_TRANSFORMS))
    window.dispatchEvent(new CustomEvent(WRITING_TRANSFORMS_EVENT, { detail: DEFAULT_TRANSFORMS }))
  }, [])

  return [transforms, setTransforms, resetToDefaults]
}
