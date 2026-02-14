import type { Fragment } from '@/lib/api'
import { parseVisualRefs, type BoundaryBox } from '@/lib/fragment-visuals'

export interface ClipboardAttachment {
  kind: 'image' | 'icon'
  name: string
  description: string
  content: string
  boundary?: BoundaryBox
}

export interface FragmentClipboardData {
  _errata: 'fragment'
  version: 1
  source: string
  exportedAt: string
  fragment: {
    type: string
    name: string
    description: string
    content: string
    tags: string[]
    sticky: boolean
  }
  attachments?: ClipboardAttachment[]
}

const SOURCE_KEY = 'errata-source-id'

export function getSourceId(): string {
  if (typeof window === 'undefined') return 'unknown'
  let id = localStorage.getItem(SOURCE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(SOURCE_KEY, id)
  }
  return id
}

export function serializeFragment(
  fragment: Fragment,
  mediaById?: Map<string, Fragment>,
): string {
  // Collect attached images/icons via visualRefs
  const attachments: ClipboardAttachment[] = []
  if (mediaById) {
    const refs = parseVisualRefs(fragment.meta)
    for (const ref of refs) {
      const media = mediaById.get(ref.fragmentId)
      if (media) {
        attachments.push({
          kind: ref.kind,
          name: media.name,
          description: media.description,
          content: media.content,
          boundary: ref.boundary,
        })
      }
    }
  }

  const data: FragmentClipboardData = {
    _errata: 'fragment',
    version: 1,
    source: getSourceId(),
    exportedAt: new Date().toISOString(),
    fragment: {
      type: fragment.type,
      name: fragment.name,
      description: fragment.description,
      content: fragment.content,
      tags: fragment.tags,
      sticky: fragment.sticky,
    },
    ...(attachments.length > 0 ? { attachments } : {}),
  }
  return JSON.stringify(data, null, 2)
}

export function parseFragmentClipboard(text: string): FragmentClipboardData | null {
  try {
    const data = JSON.parse(text)
    if (data?._errata !== 'fragment' || data?.version !== 1) return null
    const f = data.fragment
    if (!f || typeof f.type !== 'string' || typeof f.name !== 'string' || typeof f.content !== 'string') return null
    return data as FragmentClipboardData
  } catch {
    return null
  }
}

export async function copyFragmentToClipboard(
  fragment: Fragment,
  mediaById?: Map<string, Fragment>,
): Promise<void> {
  const text = serializeFragment(fragment, mediaById)
  await navigator.clipboard.writeText(text)
}

export async function readFragmentFromClipboard(): Promise<FragmentClipboardData | null> {
  try {
    const text = await navigator.clipboard.readText()
    return parseFragmentClipboard(text)
  } catch {
    return null
  }
}
