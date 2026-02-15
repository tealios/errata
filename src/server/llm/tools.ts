import { tool } from 'ai'
import { z } from 'zod/v4'
import {
  createFragment as createFragmentInStorage,
  getFragment,
  listFragments,
  updateFragment,
  deleteFragment,
} from '../fragments/storage'
import { getActiveProseIds } from '../fragments/prose-chain'
import { registry } from '../fragments/registry'
import { createLogger } from '../logging'
import type { Fragment } from '../fragments/schema'
import { generateFragmentId } from '@/lib/fragment-ids'

const logger = createLogger('llm-tools')
const TOOL_LOG_MAX_CHARS = 1200

function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val as object)) return '[Circular]'
        seen.add(val as object)
      }
      return val
    })
  } catch {
    return String(value)
  }
}

function truncateForLog(value: unknown): string {
  const text = safeStringify(value)
  if (text.length <= TOOL_LOG_MAX_CHARS) return text
  return `${text.slice(0, TOOL_LOG_MAX_CHARS)}... [truncated ${text.length - TOOL_LOG_MAX_CHARS} chars]`
}

function withToolLogging<TInput, TResult>(
  toolName: string,
  storyId: string,
  handler: (input: TInput) => Promise<TResult>,
) {
  return async (input: TInput): Promise<TResult> => {
    const startTime = Date.now()
    logger.debug(`Tool call: ${toolName} (input)`, {
      storyId,
      input: truncateForLog(input),
    })

    try {
      const result = await handler(input)
      const durationMs = Date.now() - startTime
      logger.info(`Tool call: ${toolName} (output)`, {
        storyId,
        durationMs,
        output: truncateForLog(result),
      })
      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      logger.error(`Tool call: ${toolName} failed`, {
        storyId,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function pluralize(name: string): string {
  const massNouns = ['prose', 'knowledge']
  if (massNouns.includes(name.toLowerCase())) return name
  return name + 's'
}

export interface FragmentToolsOptions {
  readOnly?: boolean
}

/**
 * Creates LLM tool definitions for fragment operations.
 *
 * Generates type-specific aliased read tools per registered fragment type:
 *   getCharacter(id), listCharacters(), getProse(id), listProse(), etc.
 *
 * Write tools (updateFragment, editFragment, deleteFragment) are generic
 * and only included when readOnly is false.
 *
 * @param readOnly - If true (default), only read tools are included. Safer for generation.
 */
export function createFragmentTools(
  dataDir: string,
  storyId: string,
  opts: FragmentToolsOptions = {},
) {
  const { readOnly = true } = opts

  const tools: Record<string, ReturnType<typeof tool>> = {}
  const types = registry.listTypes()

  for (const typeDef of types) {
    // Skip types that opt out of LLM tools (content already in context)
    if (typeDef.llmTools === false) continue

    const name = capitalize(typeDef.type) // "Character"
    const plural = pluralize(name) // "Characters" or "Prose"

    // get{Type}(id) — always included
    tools[`get${name}`] = tool({
      description: `Get the full content of a ${typeDef.type} fragment by its ID`,
      inputSchema: z.object({
        id: z.string().describe(`The ${typeDef.type} fragment ID (e.g. ${typeDef.prefix}-a1b2)`),
      }),
      execute: withToolLogging(`get${name}`, storyId, async ({ id }: { id: string }) => {
        const fragment = await getFragment(dataDir, storyId, id)
        if (!fragment) {
          return { error: `Fragment not found: ${id}` }
        }
        return {
          id: fragment.id,
          type: fragment.type,
          name: fragment.name,
          description: fragment.description,
          content: fragment.content,
          tags: fragment.tags,
          refs: fragment.refs,
          sticky: fragment.sticky,
        }
      }),
    })

    // list{Types}() — always included, no params needed
    tools[`list${plural}`] = tool({
      description: `List all ${typeDef.type} fragments (returns id, name, description)`,
      inputSchema: z.object({}),
      execute: withToolLogging(`list${plural}`, storyId, async () => {
        const fragments = await listFragments(dataDir, storyId, typeDef.type)
        return {
          fragments: fragments.map((f) => ({
            id: f.id,
            name: f.name,
            description: f.description,
          })),
        }
      }),
    })
  }

  // --- Generic tools (always available, bypass llmTools flag) ---

  tools.getFragment = tool({
    description: 'Get any fragment by its ID (works for all types: prose, character, guideline, knowledge, etc.)',
    inputSchema: z.object({
      id: z.string().describe('The fragment ID (e.g. pr-a1b2, ch-c3d4, gl-e5f6, kn-g7h8)'),
    }),
    execute: withToolLogging('getFragment', storyId, async ({ id }: { id: string }) => {
      const fragment = await getFragment(dataDir, storyId, id)
      if (!fragment) {
        return { error: `Fragment not found: ${id}` }
      }
      return {
        id: fragment.id,
        type: fragment.type,
        name: fragment.name,
        description: fragment.description,
        content: fragment.content,
        tags: fragment.tags,
        refs: fragment.refs,
        sticky: fragment.sticky,
      }
    }),
  })

  tools.listFragments = tool({
    description: 'List fragments, optionally filtered by type. Returns id, type, name, description for each.',
    inputSchema: z.object({
      type: z.string().optional().describe('Filter by fragment type (e.g. "prose", "character", "guideline", "knowledge"). Omit to list all.'),
    }),
    execute: withToolLogging('listFragments', storyId, async ({ type }: { type?: string }) => {
      const fragments = await listFragments(dataDir, storyId, type)
      return {
        fragments: fragments.filter((f) => !f.archived).map((f) => ({
          id: f.id,
          type: f.type,
          name: f.name,
          description: f.description,
        })),
      }
    }),
  })

  tools.searchFragments = tool({
    description: 'Search for text across all fragments. Returns matching fragment IDs, types, names, and the matched excerpts.',
    inputSchema: z.object({
      query: z.string().describe('The text to search for (case-insensitive)'),
      type: z.string().optional().describe('Limit search to a specific fragment type'),
    }),
    execute: withToolLogging('searchFragments', storyId, async ({ query, type }: { query: string; type?: string }) => {
      const fragments = await listFragments(dataDir, storyId, type)
      const lowerQuery = query.toLowerCase()
      const matches: Array<{ id: string; type: string; name: string; excerpt: string }> = []
      for (const f of fragments) {
        if (f.archived) continue
        const idx = f.content.toLowerCase().indexOf(lowerQuery)
        if (idx !== -1) {
          const start = Math.max(0, idx - 40)
          const end = Math.min(f.content.length, idx + query.length + 40)
          matches.push({
            id: f.id,
            type: f.type,
            name: f.name,
            excerpt: (start > 0 ? '...' : '') + f.content.slice(start, end) + (end < f.content.length ? '...' : ''),
          })
        }
      }
      return { matches, total: matches.length }
    }),
  })

  tools.listFragmentTypes = tool({
    description: 'List all available fragment types',
    inputSchema: z.object({}),
    execute: withToolLogging('listFragmentTypes', storyId, async () => {
      return {
        types: registry.listTypes().map((t) => ({
          type: t.type,
          prefix: t.prefix,
          stickyByDefault: t.stickyByDefault,
        })),
      }
    }),
  })

  // Write tools only when not readOnly
  if (!readOnly) {
    tools.createFragment = tool({
      description: 'Create a new fragment (character, guideline, knowledge, prose, image, icon, or plugin type)',
      inputSchema: z.object({
        type: z.string().describe('Fragment type, e.g. character, guideline, knowledge, prose'),
        name: z.string().max(100).describe('Fragment name/title'),
        description: z.string().max(50).describe('Short description (max 50 chars)'),
        content: z.string().describe('Full fragment content'),
      }),
      execute: withToolLogging('createFragment', storyId, async ({ type, name, description, content }) => {
        const id = generateFragmentId(type)
        const now = new Date().toISOString()
        const fragment: Fragment = {
          id,
          type,
          name,
          description,
          content,
          tags: [],
          refs: [],
          sticky: registry.getType(type)?.stickyByDefault ?? false,
          placement: 'user',
          createdAt: now,
          updatedAt: now,
          order: 0,
          meta: {},
        }
        await createFragmentInStorage(dataDir, storyId, fragment)
        return { ok: true, id, type }
      }),
    })

    tools.updateFragment = tool({
      description: 'Overwrite a fragment with entirely new content',
      inputSchema: z.object({
        fragmentId: z.string().describe('The fragment ID'),
        newContent: z.string().describe('The new content to set'),
        newDescription: z.string().max(50).describe('Updated description (max 50 chars)'),
      }),
      execute: withToolLogging('updateFragment', storyId, async ({ fragmentId, newContent, newDescription }) => {
        const fragment = await getFragment(dataDir, storyId, fragmentId)
        if (!fragment) {
          return { error: `Fragment not found: ${fragmentId}` }
        }
        const updated: Fragment = {
          ...fragment,
          content: newContent,
          description: newDescription,
          updatedAt: new Date().toISOString(),
        }
        await updateFragment(dataDir, storyId, updated)
        return { ok: true, id: fragmentId }
      }),
    })

    tools.editFragment = tool({
      description:
        'Edit a fragment by replacing a specific text span (for large prose/knowledge)',
      inputSchema: z.object({
        fragmentId: z.string().describe('The fragment ID'),
        oldText: z.string().describe('The exact text to find and replace'),
        newText: z.string().describe('The replacement text'),
      }),
      execute: withToolLogging('editFragment', storyId, async ({ fragmentId, oldText, newText }) => {
        const fragment = await getFragment(dataDir, storyId, fragmentId)
        if (!fragment) {
          return { error: `Fragment not found: ${fragmentId}` }
        }
        if (!fragment.content.includes(oldText)) {
          return { error: `Text not found in fragment ${fragmentId}: "${oldText}"` }
        }
        const updated: Fragment = {
          ...fragment,
          content: fragment.content.replace(oldText, newText),
          updatedAt: new Date().toISOString(),
        }
        await updateFragment(dataDir, storyId, updated)
        return { ok: true, id: fragmentId }
      }),
    })

    tools.deleteFragment = tool({
      description: 'Delete a fragment',
      inputSchema: z.object({
        fragmentId: z.string().describe('The fragment ID to delete'),
      }),
      execute: withToolLogging('deleteFragment', storyId, async ({ fragmentId }) => {
        await deleteFragment(dataDir, storyId, fragmentId)
        return { ok: true, id: fragmentId }
      }),
    })

    tools.editProse = tool({
      description:
        'Search and replace text across active prose fragments in the story chain. Scans every active prose fragment for oldText and replaces with newText. Returns which fragments were modified. Use this for sweeping prose edits — no need to specify fragment IDs.',
      inputSchema: z.object({
        oldText: z.string().describe('The exact text to find (matched as-is across active prose)'),
        newText: z.string().describe('The replacement text'),
      }),
      execute: withToolLogging('editProse', storyId, async ({ oldText, newText }) => {
        // Only edit prose in the active chain, not inactive variations
        const activeIds = await getActiveProseIds(dataDir, storyId)
        const proseFragments: Fragment[] = []
        if (activeIds.length > 0) {
          for (const id of activeIds) {
            const f = await getFragment(dataDir, storyId, id)
            if (f && !f.archived) proseFragments.push(f)
          }
        } else {
          // Fallback: no chain yet, use all prose
          const all = await listFragments(dataDir, storyId, 'prose')
          proseFragments.push(...all.filter(f => !f.archived))
        }

        const edited: string[] = []
        for (const f of proseFragments) {
          if (f.content.includes(oldText)) {
            const updated: Fragment = {
              ...f,
              content: f.content.replace(oldText, newText),
              updatedAt: new Date().toISOString(),
            }
            await updateFragment(dataDir, storyId, updated)
            edited.push(f.id)
          }
        }
        if (edited.length === 0) {
          return { error: `Text not found in any active prose fragment: "${oldText.slice(0, 80)}"` }
        }
        return { ok: true, editedFragments: edited, count: edited.length }
      }),
    })
  }

  return tools
}
