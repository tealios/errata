/**
 * TavernAI / SillyTavern character card importer.
 *
 * Supports two input formats:
 *   1. PNG files with JSON data embedded as base64 in tEXt chunks
 *   2. Raw JSON files (V2/V3 character card spec)
 *
 * Card specs:
 *   - "chara"  → chara_card_v2 (spec_version "2.0")
 *   - "ccv3"   → chara_card_v3 (spec_version "3.0")
 *
 * Both carry the same payload shape for the fields we care about.
 * Also parses `character_book` (lorebook) entries into importable items.
 * This module is browser-safe (no Node APIs) and fully self-contained.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface CharacterBookEntry {
  keys: string[]
  secondaryKeys: string[]
  content: string
  comment: string
  name: string
  enabled: boolean
  constant: boolean
  selective: boolean
  insertionOrder: number
  position: 'before_char' | 'after_char' | ''
  priority: number
  id: number | string
}

export interface CharacterBook {
  name: string
  entries: CharacterBookEntry[]
}

export interface TavernCardData {
  name: string
  description: string
  personality: string
  firstMessage: string
  messageExamples: string
  scenario: string
  creatorNotes: string
  systemPrompt: string
  postHistoryInstructions: string
  alternateGreetings: string[]
  tags: string[]
  creator: string
  characterVersion: string
  spec: string
  specVersion: string
  characterBook: CharacterBook | null
}

export type ImportableItemType = 'character' | 'knowledge' | 'guideline' | 'prose'

export interface ImportableItem {
  key: string
  suggestedType: ImportableItemType
  name: string
  description: string
  content: string
  tags: string[]
  sticky: boolean
  placement: 'system' | 'user'
  order: number
  enabled: boolean
  source: 'main-character' | 'scenario' | 'first-message' | 'system-prompt' | 'lorebook-entry'
  meta: Record<string, unknown>
}

export interface ParsedCharacterCard {
  card: TavernCardData
  book: CharacterBook | null
  items: ImportableItem[]
}

/** Mapped to Errata's fragment shape, ready for creation. */
export interface ImportedCharacter {
  type: 'character'
  name: string
  description: string
  content: string
  tags: string[]
  meta: {
    importSource: 'tavern-card'
    tavernSpec: string
    tavernCreator: string
    scenario?: string
    firstMessage?: string
    messageExamples?: string
    systemPrompt?: string
    postHistoryInstructions?: string
    alternateGreetings?: string[]
    creatorNotes?: string
  }
}

// ── PNG parsing ────────────────────────────────────────────────────────

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false) // big-endian
}

function bytesToLatin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i])
  }
  return s
}

interface PngTextChunk {
  keyword: string
  text: string
}

function extractTextChunks(buffer: ArrayBuffer): PngTextChunk[] {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  // Verify PNG signature
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Not a valid PNG file')
    }
  }

  const chunks: PngTextChunk[] = []
  let pos = 8 // skip signature

  while (pos + 8 <= bytes.length) {
    const length = readUint32(view, pos)
    const typeBytes = bytes.slice(pos + 4, pos + 8)
    const type = bytesToLatin1(typeBytes)

    if (type === 'tEXt') {
      const data = bytes.slice(pos + 8, pos + 8 + length)
      const nullIdx = data.indexOf(0)
      if (nullIdx !== -1) {
        const keyword = bytesToLatin1(data.slice(0, nullIdx))
        const text = bytesToLatin1(data.slice(nullIdx + 1))
        chunks.push({ keyword, text })
      }
    }

    if (type === 'IEND') break

    pos += 12 + length // 4 length + 4 type + data + 4 crc
  }

  return chunks
}

// ── Card decoding ──────────────────────────────────────────────────────

function decodeCardJson(base64Text: string): Record<string, unknown> {
  const binary = atob(base64Text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const json = new TextDecoder().decode(bytes)
  return JSON.parse(json)
}

function parseCardData(raw: Record<string, unknown>): TavernCardData {
  const data = (raw.data ?? raw) as Record<string, unknown>
  return {
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    personality: String(data.personality ?? ''),
    firstMessage: String(data.first_mes ?? ''),
    messageExamples: String(data.mes_example ?? ''),
    scenario: String(data.scenario ?? ''),
    creatorNotes: String(data.creator_notes ?? ''),
    systemPrompt: String(data.system_prompt ?? ''),
    postHistoryInstructions: String(data.post_history_instructions ?? ''),
    alternateGreetings: Array.isArray(data.alternate_greetings)
      ? data.alternate_greetings.map(String)
      : [],
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    creator: String(data.creator ?? ''),
    characterVersion: String(data.character_version ?? ''),
    spec: String(raw.spec ?? ''),
    specVersion: String(raw.spec_version ?? ''),
    characterBook: parseCharacterBook(data.character_book),
  }
}

// ── Character book / lorebook parsing ──────────────────────────────────

function parseCharacterBookEntry(raw: unknown): CharacterBookEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  // Must have at least content to be useful
  const content = String(e.content ?? '')
  if (!content) return null
  return {
    keys: Array.isArray(e.keys) ? e.keys.map(String) : [],
    secondaryKeys: Array.isArray(e.secondary_keys ?? e.secondaryKeys)
      ? (Array.isArray(e.secondary_keys) ? e.secondary_keys : e.secondaryKeys as unknown[]).map(String)
      : [],
    content,
    comment: String(e.comment ?? ''),
    name: String(e.name ?? ''),
    enabled: e.enabled !== false,
    constant: e.constant === true,
    selective: e.selective === true,
    insertionOrder: Number(e.insertion_order ?? e.insertionOrder ?? 0),
    position: (['before_char', 'after_char'].includes(String(e.position ?? ''))
      ? String(e.position)
      : '') as CharacterBookEntry['position'],
    priority: Number(e.priority ?? 0),
    id: (typeof e.id === 'number' || typeof e.id === 'string') ? e.id : 0,
  }
}

function parseCharacterBook(raw: unknown): CharacterBook | null {
  if (!raw || typeof raw !== 'object') return null
  const book = raw as Record<string, unknown>
  const rawEntries = Array.isArray(book.entries) ? book.entries : []
  const entries = rawEntries
    .map(parseCharacterBookEntry)
    .filter((e): e is CharacterBookEntry => e !== null)
  if (entries.length === 0 && !book.name) return null
  return {
    name: String(book.name ?? ''),
    entries,
  }
}

/** Heuristic to guess the best Errata fragment type for a lorebook entry. */
export function inferEntryType(entry: CharacterBookEntry): 'character' | 'knowledge' | 'guideline' {
  if (entry.constant || entry.position === 'before_char') return 'guideline'
  return 'knowledge'
}

function truncateDescription(text: string, max = 250): string {
  if (text.length <= max) return text
  return text.slice(0, max - 3) + '...'
}

/** Build the full list of importable items from a parsed card + book. */
export function buildImportableItems(card: TavernCardData, book: CharacterBook | null): ImportableItem[] {
  const items: ImportableItem[] = []
  let order = 0

  // Main character — always first, always enabled
  const charSections: string[] = []
  if (card.description) charSections.push(card.description)
  if (card.personality) charSections.push(`## Personality\n${card.personality}`)

  items.push({
    key: 'main-character',
    suggestedType: 'character',
    name: card.name,
    description: truncateDescription(card.description),
    content: charSections.join('\n\n'),
    tags: card.tags,
    sticky: false,
    placement: 'user',
    order: order++,
    enabled: true,
    source: 'main-character',
    meta: {
      importSource: 'tavern-card',
      tavernSpec: card.spec,
      tavernCreator: card.creator,
    },
  })

  // Scenario → knowledge
  if (card.scenario) {
    items.push({
      key: 'scenario',
      suggestedType: 'knowledge',
      name: `${card.name} — Scenario`,
      description: truncateDescription(card.scenario),
      content: card.scenario,
      tags: [],
      sticky: false,
      placement: 'user',
      order: order++,
      enabled: true,
      source: 'scenario',
      meta: { importSource: 'tavern-card' },
    })
  }

  // First message → prose
  if (card.firstMessage) {
    items.push({
      key: 'first-message',
      suggestedType: 'prose',
      name: `${card.name} — Opening`,
      description: truncateDescription(card.firstMessage),
      content: card.firstMessage,
      tags: [],
      sticky: false,
      placement: 'user',
      order: order++,
      enabled: true,
      source: 'first-message',
      meta: { importSource: 'tavern-card' },
    })
  }

  // System prompt → guideline, sticky, placement=system
  if (card.systemPrompt) {
    items.push({
      key: 'system-prompt',
      suggestedType: 'guideline',
      name: `${card.name} — System Prompt`,
      description: truncateDescription(card.systemPrompt),
      content: card.systemPrompt,
      tags: [],
      sticky: true,
      placement: 'system',
      order: order++,
      enabled: true,
      source: 'system-prompt',
      meta: { importSource: 'tavern-card' },
    })
  }

  // Lorebook entries
  if (book) {
    for (const entry of book.entries) {
      const entryName = entry.name || entry.comment || entry.keys.slice(0, 3).join(' / ') || `Entry ${entry.id}`
      const entryType = inferEntryType(entry)
      items.push({
        key: `lorebook-${entry.id}`,
        suggestedType: entryType,
        name: entryName,
        description: truncateDescription(entry.content),
        content: entry.content,
        tags: entry.keys,
        sticky: entry.constant,
        placement: entry.position === 'before_char' ? 'system' : 'user',
        order: order++,
        enabled: entry.enabled,
        source: 'lorebook-entry',
        meta: {
          importSource: 'tavern-card',
          lorebookEntryId: entry.id,
          insertionOrder: entry.insertionOrder,
          priority: entry.priority,
          selective: entry.selective,
          secondaryKeys: entry.secondaryKeys,
          constant: entry.constant,
          position: entry.position,
        },
      })
    }
  }

  return items
}

// ── Public API ─────────────────────────────────────────────────────────

/** Extract all TavernAI character cards found in a PNG file. */
export function extractTavernCards(buffer: ArrayBuffer): TavernCardData[] {
  const textChunks = extractTextChunks(buffer)
  const cards: TavernCardData[] = []

  // Prefer ccv3 over chara (v3 is the newer spec)
  const cardChunks = textChunks.filter(
    (c) => c.keyword === 'ccv3' || c.keyword === 'chara',
  )

  for (const chunk of cardChunks) {
    try {
      const raw = decodeCardJson(chunk.text)
      cards.push(parseCardData(raw))
    } catch {
      // Skip malformed chunks
    }
  }

  return cards
}

/** Check whether an ArrayBuffer looks like a PNG with tavern card data. */
export function isTavernCardPng(buffer: ArrayBuffer): boolean {
  try {
    return extractTavernCards(buffer).length > 0
  } catch {
    return false
  }
}

/**
 * Parse a TavernAI character card PNG and return data ready for
 * Errata fragment creation.
 *
 * Prefers the ccv3 (v3) card if both are present.
 */
export function importTavernCard(buffer: ArrayBuffer): ImportedCharacter {
  const cards = extractTavernCards(buffer)
  if (cards.length === 0) {
    throw new Error('No TavernAI character card data found in PNG')
  }

  // Prefer v3 over v2
  const card = cards.find((c) => c.spec === 'chara_card_v3') ?? cards[0]

  // Build content from name, description, and personality only
  const sections: string[] = []

  if (card.description) {
    sections.push(card.description)
  }

  if (card.personality) {
    sections.push(`## Personality\n${card.personality}`)
  }

  // Truncate description to 250 chars for the fragment description field
  const shortDesc = card.description.length > 250
    ? card.description.slice(0, 247) + '...'
    : card.description

  // Everything else goes into meta for reference
  const meta: ImportedCharacter['meta'] = {
    importSource: 'tavern-card',
    tavernSpec: card.spec,
    tavernCreator: card.creator,
  }
  if (card.scenario) meta.scenario = card.scenario
  if (card.firstMessage) meta.firstMessage = card.firstMessage
  if (card.messageExamples) meta.messageExamples = card.messageExamples
  if (card.systemPrompt) meta.systemPrompt = card.systemPrompt
  if (card.postHistoryInstructions) meta.postHistoryInstructions = card.postHistoryInstructions
  if (card.alternateGreetings.length > 0) meta.alternateGreetings = card.alternateGreetings
  if (card.creatorNotes) meta.creatorNotes = card.creatorNotes

  return {
    type: 'character',
    name: card.name,
    description: shortDesc,
    content: sections.join('\n\n'),
    tags: card.tags,
    meta,
  }
}

/**
 * Parse a raw JSON string as a character card (V2 or V3).
 * Returns null if the JSON is not a recognized card format.
 */
export function parseCardJson(text: string): ParsedCharacterCard | null {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  // Reject Errata export format
  if ('_errata' in raw) return null

  // Detect tavern card shape: needs `data.name` or root `name`, and
  // either `spec` field or `data` wrapper with character fields
  const data = (raw.data ?? raw) as Record<string, unknown>
  if (!data.name || typeof data.name !== 'string') return null

  // Must have at least one character-card-specific field
  const cardFields = ['description', 'personality', 'first_mes', 'scenario', 'system_prompt', 'character_book']
  const hasCardField = cardFields.some((f) => f in data && data[f] !== undefined)
  if (!hasCardField && !raw.spec) return null

  const card = parseCardData(raw)
  const book = card.characterBook
  const items = buildImportableItems(card, book)
  return { card, book, items }
}

/** Quick detection: is this JSON text a tavern character card? */
export function isTavernCardJson(text: string): boolean {
  return parseCardJson(text) !== null
}

/**
 * Extract a ParsedCharacterCard from a PNG buffer.
 * Returns null if no card data is found.
 */
export function extractParsedCard(buffer: ArrayBuffer): ParsedCharacterCard | null {
  const cards = extractTavernCards(buffer)
  if (cards.length === 0) return null
  const card = cards.find((c) => c.spec === 'chara_card_v3') ?? cards[0]
  const book = card.characterBook
  const items = buildImportableItems(card, book)
  return { card, book, items }
}
