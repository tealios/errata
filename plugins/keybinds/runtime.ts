import {
  eventCombo,
  isTypingTarget,
  normalizeCombo,
  currentStoryIdFromLocation,
  loadBindingsForStory,
  type ActionId,
} from './shared'

function proseBlocks(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-prose-index]')) as HTMLElement[]
}

function jumpRelative(delta: number) {
  const blocks = proseBlocks().sort((a, b) => {
    const ai = Number(a.dataset.proseIndex ?? 0)
    const bi = Number(b.dataset.proseIndex ?? 0)
    return ai - bi
  })
  if (blocks.length === 0) return

  const viewport = document.querySelector('[data-component-id="prose-chain-scroll"] [data-radix-scroll-area-viewport]') as HTMLElement | null
  const viewRect = viewport?.getBoundingClientRect()
  const centerY = viewRect ? viewRect.top + viewRect.height / 2 : window.innerHeight / 2

  let current = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < blocks.length; i++) {
    const r = blocks[i].getBoundingClientRect()
    const y = r.top + r.height / 2
    const d = Math.abs(y - centerY)
    if (d < bestDist) {
      bestDist = d
      current = i
    }
  }

  const target = Math.max(0, Math.min(blocks.length - 1, current + delta))
  blocks[target].scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function runAction(action: ActionId) {
  switch (action) {
    case 'jumpBottom': {
      const btn = document.querySelector('[data-component-id="prose-outline-scroll-bottom"]') as HTMLButtonElement | null
      if (btn) {
        btn.click()
        return
      }
      const viewport = document.querySelector('[data-component-id="prose-chain-scroll"] [data-radix-scroll-area-viewport]') as HTMLElement | null
      viewport?.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
      return
    }
    case 'jumpNextProse':
      jumpRelative(1)
      return
    case 'jumpPrevProse':
      jumpRelative(-1)
      return
    case 'toggleOutline': {
      const btn = document.querySelector('[data-component-id="prose-outline-toggle"]') as HTMLButtonElement | null
      btn?.click()
      return
    }
    case 'closeFragment': {
      const btn = document.querySelector('[data-component-id="fragment-editor-close"]') as HTMLButtonElement | null
      btn?.click()
      return
    }
  }
}

let started = false
let keydownHandler: ((e: KeyboardEvent) => void) | null = null

export function startKeybindRuntime() {
  if (started || typeof window === 'undefined') return
  started = true

  keydownHandler = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return
    const storyId = currentStoryIdFromLocation()
    if (!storyId) return

    const bindings = loadBindingsForStory(storyId)
    const combo = eventCombo(e)
    const hit = (Object.keys(bindings) as ActionId[])
      .find((action) => normalizeCombo(bindings[action]) === combo)
    if (!hit) return

    e.preventDefault()
    runAction(hit)
  }

  window.addEventListener('keydown', keydownHandler)
}

export function stopKeybindRuntime() {
  if (!started || typeof window === 'undefined') return
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler)
  }
  keydownHandler = null
  started = false
}
