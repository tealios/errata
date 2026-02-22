import { type ReactNode, createElement, Children, isValidElement, cloneElement } from 'react'
import { hashString, CHARACTER_MENTION_COLORS } from './fragment-visuals'
import { CharacterMentionSpan } from '@/components/prose/CharacterMentionSpan'

export interface Annotation {
  type: string
  fragmentId: string
  text: string
}

function colorForId(fragmentId: string): string {
  const idx = Math.abs(hashString(fragmentId)) % CHARACTER_MENTION_COLORS.length
  return CHARACTER_MENTION_COLORS[idx]
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildAnnotationHighlighter(
  annotations: Annotation[],
  onClick: (fragmentId: string) => void,
  colorOverrides?: Map<string, string>,
): ((text: string) => ReactNode) | null {
  const mentions = annotations.filter(a => a.type === 'mention')
  if (mentions.length === 0) return null

  // Deduplicate by text (case-insensitive), keep longest first
  const seen = new Set<string>()
  const unique: Annotation[] = []
  // Sort longest-first so longer names match before shorter substrings
  const sorted = [...mentions].sort((a, b) => b.text.length - a.text.length)
  for (const m of sorted) {
    const key = m.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(m)
  }

  // Build a map from lowercase text -> annotation for lookup
  const textMap = new Map<string, Annotation>()
  for (const m of unique) {
    textMap.set(m.text.toLowerCase(), m)
  }

  // Build regex with word boundaries, case-insensitive
  const pattern = unique.map(m => escapeRegex(m.text)).join('|')
  const regex = new RegExp(`\\b(${pattern})\\b`, 'gi')

  return (text: string): ReactNode => {
    const parts: ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    // Reset regex state
    regex.lastIndex = 0

    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0]
      const annotation = textMap.get(matchedText.toLowerCase())
      if (!annotation) continue

      // Add text before match
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index))
      }

      const color = colorOverrides?.get(annotation.fragmentId) ?? colorForId(annotation.fragmentId)
      parts.push(
        createElement(
          CharacterMentionSpan,
          {
            key: `${match.index}-${matchedText}`,
            fragmentId: annotation.fragmentId,
            className: 'mention-highlight',
            style: { color },
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation()
              onClick(annotation.fragmentId)
            },
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                e.preventDefault()
                onClick(annotation.fragmentId)
              }
            },
          },
          matchedText,
        ),
      )

      lastIndex = match.index + matchedText.length
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex))
    }

    // If no matches found, return original text
    if (parts.length === 0) return text

    return parts
  }
}

/**
 * Strip markdown emphasis markers (* and _) from inside dialogue quotes
 * so that markdown parsing doesn't split dialogue across element boundaries.
 * e.g. `"I don't *really* know"` → `"I don't really know"`
 *
 * Since the entire dialogue is wrapped in `<em>` by `formatDialogue`,
 * inner emphasis is redundant and can be safely removed.
 */
export function stripEmphasisInDialogue(content: string): string {
  return content.replace(/[""\u201c](?:[^""\u201c\u201d])*?[""\u201d]/g, (dialogue) =>
    dialogue.replace(/(\*{1,3}|_{1,3})(.+?)\1/g, '$2'),
  )
}

/** Italicize dialogue enclosed in double quotes (ASCII " or curly \u201c\u201d) */
export function formatDialogue(text: string): ReactNode {
  const regex = /[""\u201c](?:[^""\u201c\u201d])*?[""\u201d]/g
  let lastIndex = 0
  const parts: ReactNode[] = []
  let key = 0

  for (const match of text.matchAll(regex)) {
    const start = match.index!
    if (start > lastIndex) parts.push(text.slice(lastIndex, start))
    parts.push(createElement('em', { key: key++, className: 'prose-dialogue' }, match[0]))
    lastIndex = start + match[0].length
  }

  if (parts.length === 0) return text
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

/** Compose two text transforms: apply `first`, then apply `second` to any remaining string children */
export function composeTextTransforms(
  first: (text: string) => ReactNode,
  second: (text: string) => ReactNode,
): (text: string) => ReactNode {
  return (text: string) => {
    const result = first(text)
    if (typeof result === 'string') return second(result)
    return applyToStringChildren(result, second)
  }
}

function applyToStringChildren(node: ReactNode, transform: (text: string) => ReactNode): ReactNode {
  return Children.map(node, child => {
    if (typeof child === 'string') return transform(child)
    if (isValidElement(child) && (child.props as Record<string, unknown>).children) {
      return cloneElement(child, {}, applyToStringChildren((child.props as Record<string, unknown>).children as ReactNode, transform))
    }
    return child
  })
}
