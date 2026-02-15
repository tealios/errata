import type { Fragment } from '@/lib/api'
import { parseVisualRefs, type BoundaryBox } from '@/lib/fragment-visuals'

export interface ClipboardAttachment {
  kind: 'image' | 'icon'
  name: string
  description: string
  content: string
  boundary?: BoundaryBox
}

export interface FragmentExportEntry {
  type: string
  name: string
  description: string
  content: string
  tags: string[]
  sticky: boolean
  attachments?: ClipboardAttachment[]
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

export interface FragmentBundleData {
  _errata: 'fragment-bundle'
  version: 1
  source: string
  exportedAt: string
  storyName?: string
  fragments: FragmentExportEntry[]
}

export type ErrataExportData = FragmentClipboardData | FragmentBundleData

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

function collectAttachments(
  fragment: Fragment,
  mediaById?: Map<string, Fragment>,
): ClipboardAttachment[] {
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
  return attachments
}

export function serializeFragment(
  fragment: Fragment,
  mediaById?: Map<string, Fragment>,
): string {
  const attachments = collectAttachments(fragment, mediaById)

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

export function serializeBundle(
  fragments: Fragment[],
  mediaById?: Map<string, Fragment>,
  storyName?: string,
): string {
  const entries: FragmentExportEntry[] = fragments.map((fragment) => {
    const attachments = collectAttachments(fragment, mediaById)
    return {
      type: fragment.type,
      name: fragment.name,
      description: fragment.description,
      content: fragment.content,
      tags: fragment.tags,
      sticky: fragment.sticky,
      ...(attachments.length > 0 ? { attachments } : {}),
    }
  })

  const data: FragmentBundleData = {
    _errata: 'fragment-bundle',
    version: 1,
    source: getSourceId(),
    exportedAt: new Date().toISOString(),
    ...(storyName ? { storyName } : {}),
    fragments: entries,
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

export function parseBundleClipboard(text: string): FragmentBundleData | null {
  try {
    const data = JSON.parse(text)
    if (data?._errata !== 'fragment-bundle' || data?.version !== 1) return null
    if (!Array.isArray(data.fragments) || data.fragments.length === 0) return null
    for (const f of data.fragments) {
      if (!f || typeof f.type !== 'string' || typeof f.name !== 'string' || typeof f.content !== 'string') return null
    }
    return data as FragmentBundleData
  } catch {
    return null
  }
}

export function parseErrataExport(text: string): ErrataExportData | null {
  return parseFragmentClipboard(text) ?? parseBundleClipboard(text)
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

export function downloadExportFile(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
