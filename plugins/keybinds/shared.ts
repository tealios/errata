export type ActionId =
  | 'jumpBottom'
  | 'jumpNextProse'
  | 'jumpPrevProse'
  | 'toggleOutline'
  | 'closeFragment'

export type Bindings = Record<ActionId, string>

export const STORAGE_PREFIX = 'errata:keybinds:'

export const DEFAULT_BINDINGS: Bindings = {
  jumpBottom: 'ctrl+end',
  jumpNextProse: 'alt+j',
  jumpPrevProse: 'alt+k',
  toggleOutline: 'alt+o',
  closeFragment: 'alt+escape',
}

export const ACTION_LABELS: Record<ActionId, string> = {
  jumpBottom: 'Jump to bottom',
  jumpNextProse: 'Jump to next prose',
  jumpPrevProse: 'Jump to previous prose',
  toggleOutline: 'Collapse/expand outline',
  closeFragment: 'Close fragment panel',
}

export function normalizeCombo(combo: string): string {
  return combo
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('control', 'ctrl')
}

export function eventCombo(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')

  let key = e.key.toLowerCase()
  if (key === ' ') key = 'space'
  if (key === 'arrowdown') key = 'down'
  if (key === 'arrowup') key = 'up'
  if (key === 'arrowleft') key = 'left'
  if (key === 'arrowright') key = 'right'
  if (key === 'esc') key = 'escape'

  if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
    parts.push(key)
  }

  return normalizeCombo(parts.join('+'))
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

export function currentStoryIdFromLocation(): string | null {
  const match = window.location.pathname.match(/^\/story\/([^/]+)/)
  return match?.[1] ?? null
}

export function storageKeyForStory(storyId: string): string {
  return `${STORAGE_PREFIX}${storyId}`
}

export function loadBindingsForStory(storyId: string): Bindings {
  const raw = localStorage.getItem(storageKeyForStory(storyId))
  if (!raw) return DEFAULT_BINDINGS
  try {
    const parsed = JSON.parse(raw) as Partial<Bindings>
    return { ...DEFAULT_BINDINGS, ...parsed }
  } catch {
    return DEFAULT_BINDINGS
  }
}

export function saveBindingsForStory(storyId: string, bindings: Bindings): void {
  localStorage.setItem(storageKeyForStory(storyId), JSON.stringify(bindings))
}
