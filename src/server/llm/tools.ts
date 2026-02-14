import { tool } from 'ai'
import { z } from 'zod/v4'
import {
  getFragment,
  listFragments,
  updateFragment,
  deleteFragment,
} from '../fragments/storage'
import { registry } from '../fragments/registry'
import type { Fragment } from '../fragments/schema'

/**
 * Creates read-only LLM tools for context lookup during prose generation.
 * These tools let the LLM look up fragments but not modify them.
 */
export function createReadOnlyTools(dataDir: string, storyId: string) {
  const allTools = createFragmentTools(dataDir, storyId)
  return {
    fragmentGet: allTools.fragmentGet,
    fragmentList: allTools.fragmentList,
    fragmentTypesList: allTools.fragmentTypesList,
  }
}

/**
 * Creates LLM tool definitions for fragment operations.
 * These tools let the LLM look up and modify fragments during generation.
 */
export function createFragmentTools(dataDir: string, storyId: string) {
  return {
    fragmentGet: tool({
      description: 'Get the full content of a fragment by its ID',
      inputSchema: z.object({
        fragmentId: z.string().describe('The fragment ID (e.g. ch-a1b2)'),
      }),
      execute: async ({ fragmentId }) => {
        const fragment = await getFragment(dataDir, storyId, fragmentId)
        if (!fragment) {
          return { error: `Fragment not found: ${fragmentId}` }
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
      },
    }),

    fragmentSet: tool({
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
    }),

    fragmentEdit: tool({
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
    }),

    fragmentDelete: tool({
      description: 'Delete a fragment',
      inputSchema: z.object({
        fragmentId: z.string().describe('The fragment ID to delete'),
      }),
      execute: async ({ fragmentId }) => {
        await deleteFragment(dataDir, storyId, fragmentId)
        return { ok: true, id: fragmentId }
      },
    }),

    fragmentList: tool({
      description:
        'List all fragments of a given type (returns id, name, description only)',
      inputSchema: z.object({
        type: z
          .string()
          .describe('Fragment type: prose, character, guideline, knowledge'),
      }),
      execute: async ({ type }) => {
        const fragments = await listFragments(dataDir, storyId, type)
        return {
          fragments: fragments.map((f) => ({
            id: f.id,
            name: f.name,
            description: f.description,
          })),
        }
      },
    }),

    fragmentTypesList: tool({
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
    }),
  }
}
