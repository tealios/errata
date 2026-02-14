import { tool } from 'ai'
import { z } from 'zod/v4'
import {
  getFragment,
  listFragments,
  updateFragment,
  deleteFragment,
} from '../fragments/storage'
import { registry } from '../fragments/registry'
import { createLogger } from '../logging'
import type { Fragment } from '../fragments/schema'

const logger = createLogger('llm-tools')

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
    const name = capitalize(typeDef.type) // "Character"
    const plural = pluralize(name) // "Characters" or "Prose"

    // get{Type}(id) — always included
    tools[`get${name}`] = tool({
      description: `Get the full content of a ${typeDef.type} fragment by its ID`,
      inputSchema: z.object({
        id: z.string().describe(`The ${typeDef.type} fragment ID (e.g. ${typeDef.prefix}-a1b2)`),
      }),
      execute: async ({ id }: { id: string }) => {
        const startTime = Date.now()
        logger.debug(`Tool: get${name}`, { storyId, fragmentId: id })
        const fragment = await getFragment(dataDir, storyId, id)
        const durationMs = Date.now() - startTime
        if (!fragment) {
          logger.warn(`Tool: get${name} - Fragment not found`, { storyId, fragmentId: id, durationMs })
          return { error: `Fragment not found: ${id}` }
        }
        logger.info(`Tool: get${name} - Success`, { storyId, fragmentId: id, durationMs })
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
      },
    })

    // list{Types}() — always included, no params needed
    tools[`list${plural}`] = tool({
      description: `List all ${typeDef.type} fragments (returns id, name, description)`,
      inputSchema: z.object({}),
      execute: async () => {
        const fragments = await listFragments(dataDir, storyId, typeDef.type)
        return {
          fragments: fragments.map((f) => ({
            id: f.id,
            name: f.name,
            description: f.description,
          })),
        }
      },
    })
  }

  // Always include listFragmentTypes
  tools.listFragmentTypes = tool({
    description: 'List all available fragment types',
    inputSchema: z.object({}),
    execute: async () => {
      return {
        types: registry.listTypes().map((t) => ({
          type: t.type,
          prefix: t.prefix,
          stickyByDefault: t.stickyByDefault,
        })),
      }
    },
  })

  // Write tools only when not readOnly
  if (!readOnly) {
    tools.updateFragment = tool({
      description: 'Overwrite a fragment with entirely new content',
      inputSchema: z.object({
        fragmentId: z.string().describe('The fragment ID'),
        newContent: z.string().describe('The new content to set'),
        newDescription: z.string().max(50).describe('Updated description (max 50 chars)'),
      }),
      execute: async ({ fragmentId, newContent, newDescription }) => {
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
      },
    })

    tools.editFragment = tool({
      description:
        'Edit a fragment by replacing a specific text span (for large prose/knowledge)',
      inputSchema: z.object({
        fragmentId: z.string().describe('The fragment ID'),
        oldText: z.string().describe('The exact text to find and replace'),
        newText: z.string().describe('The replacement text'),
      }),
      execute: async ({ fragmentId, oldText, newText }) => {
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
      },
    })

    tools.deleteFragment = tool({
      description: 'Delete a fragment',
      inputSchema: z.object({
        fragmentId: z.string().describe('The fragment ID to delete'),
      }),
      execute: async ({ fragmentId }) => {
        await deleteFragment(dataDir, storyId, fragmentId)
        return { ok: true, id: fragmentId }
      },
    })
  }

  return tools
}
