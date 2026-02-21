import { api, type Fragment, type BlockConfig, type AgentBlockConfig } from '@/lib/api'
import { parseVisualRefs, type BoundaryBox } from '@/lib/fragment-visuals'

export interface ClipboardAttachment {
  kind: 'image' | 'icon'
  name: string
  description: string
  content: string
  boundary?: BoundaryBox
}

export interface FragmentExportEntry {
  id?: string
  type: string
  name: string
  description: string
  content: string
  tags: string[]
  sticky: boolean
  refs?: string[]
  placement?: 'system' | 'user'
  order?: number
  meta?: Record<string, unknown>
  attachments?: ClipboardAttachment[]
}

export interface FragmentClipboardData {
  _errata: 'fragment'
  version: 1
  source: string
  exportedAt: string
  fragment: {
    id?: string
    type: string
    name: string
    description: string
    content: string
    tags: string[]
    sticky: boolean
    refs?: string[]
    placement?: 'system' | 'user'
    order?: number
    meta?: Record<string, unknown>
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
  blockConfig?: BlockConfig
  agentBlockConfigs?: Record<string, AgentBlockConfig>
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
      id: fragment.id,
      type: fragment.type,
      name: fragment.name,
      description: fragment.description,
      content: fragment.content,
      tags: fragment.tags,
      sticky: fragment.sticky,
      ...(fragment.refs.length > 0 ? { refs: fragment.refs } : {}),
      ...(fragment.placement !== 'system' ? { placement: fragment.placement } : {}),
      ...(fragment.order !== 0 ? { order: fragment.order } : {}),
      ...(Object.keys(fragment.meta).length > 0 ? { meta: fragment.meta } : {}),
    },
    ...(attachments.length > 0 ? { attachments } : {}),
  }
  return JSON.stringify(data, null, 2)
}

export interface BundleConfigsOption {
  blockConfig?: BlockConfig
  agentBlockConfigs?: Record<string, AgentBlockConfig>
}

export function serializeBundle(
  fragments: Fragment[],
  mediaById?: Map<string, Fragment>,
  storyName?: string,
  configs?: BundleConfigsOption,
): string {
  const entries: FragmentExportEntry[] = fragments.map((fragment) => {
    const attachments = collectAttachments(fragment, mediaById)
    return {
      id: fragment.id,
      type: fragment.type,
      name: fragment.name,
      description: fragment.description,
      content: fragment.content,
      tags: fragment.tags,
      sticky: fragment.sticky,
      ...(fragment.refs.length > 0 ? { refs: fragment.refs } : {}),
      ...(fragment.placement !== 'system' ? { placement: fragment.placement } : {}),
      ...(fragment.order !== 0 ? { order: fragment.order } : {}),
      ...(Object.keys(fragment.meta).length > 0 ? { meta: fragment.meta } : {}),
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
    ...(configs?.blockConfig && !isBlockConfigEmpty(configs.blockConfig) ? { blockConfig: configs.blockConfig } : {}),
    ...(configs?.agentBlockConfigs && Object.keys(configs.agentBlockConfigs).length > 0 ? { agentBlockConfigs: configs.agentBlockConfigs } : {}),
  }
  return JSON.stringify(data, null, 2)
}

export function isBlockConfigEmpty(config: BlockConfig): boolean {
  return (
    config.customBlocks.length === 0 &&
    Object.keys(config.overrides).length === 0 &&
    config.blockOrder.length === 0
  )
}

export function isAgentBlockConfigEmpty(config: AgentBlockConfig): boolean {
  return (
    config.customBlocks.length === 0 &&
    Object.keys(config.overrides).length === 0 &&
    config.blockOrder.length === 0 &&
    config.disabledTools.length === 0
  )
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

export function downloadTextFile(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function importFragmentEntry(storyId: string, entry: FragmentExportEntry): Promise<Fragment> {
  // 1. Create attachment image/icon fragments first
  const visualRefs: Array<{ fragmentId: string; kind: 'image' | 'icon'; boundary?: { x: number; y: number; width: number; height: number } }> = []
  if (entry.attachments && entry.attachments.length > 0) {
    for (const att of entry.attachments) {
      const created = await api.fragments.create(storyId, {
        type: att.kind,
        name: att.name,
        description: att.description || '',
        content: att.content,
      })
      visualRefs.push({
        fragmentId: created.id,
        kind: att.kind,
        ...(att.boundary ? { boundary: att.boundary } : {}),
      })
    }
  }

  // 2. Create the main fragment with tags and meta
  const createMeta = {
    ...(entry.meta ?? {}),
    ...(visualRefs.length > 0 ? { visualRefs } : {}),
  }
  const created = await api.fragments.create(storyId, {
    type: entry.type,
    name: entry.name,
    description: entry.description || '',
    content: entry.content,
    ...(entry.id ? { id: entry.id } : {}),
    ...(entry.tags && entry.tags.length > 0 ? { tags: entry.tags } : {}),
    ...(Object.keys(createMeta).length > 0 ? { meta: createMeta } : {}),
  })

  // 3. Apply additional properties that require update
  const needsUpdate =
    entry.sticky ||
    (entry.placement && entry.placement !== 'system') ||
    (entry.order !== undefined && entry.order !== 0)

  if (needsUpdate) {
    await api.fragments.update(storyId, created.id, {
      name: created.name,
      description: created.description,
      content: created.content,
      ...(entry.sticky ? { sticky: true } : {}),
      ...(entry.placement ? { placement: entry.placement } : {}),
      ...(entry.order !== undefined ? { order: entry.order } : {}),
    })
  }

  return created
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
