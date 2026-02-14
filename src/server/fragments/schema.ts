import { z } from 'zod/v4'

export const FragmentIdSchema = z.string().regex(/^[a-z]{2}-[a-z0-9]{4,8}$/)

export const FRAGMENT_TYPES = ['prose', 'character', 'guideline', 'knowledge'] as const

export const FragmentTypeSchema = z.string().min(1)

export type FragmentType = z.infer<typeof FragmentTypeSchema>

export const FragmentSchema = z.object({
  id: FragmentIdSchema,
  type: FragmentTypeSchema,
  name: z.string().max(100),
  description: z.string().max(50),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  refs: z.array(FragmentIdSchema).default([]),
  sticky: z.boolean().default(false),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  order: z.int().default(0),
  meta: z.record(z.string(), z.unknown()).default({}),
})

export type Fragment = z.infer<typeof FragmentSchema>

export const StoryMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  summary: z.string().default(''),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  settings: z
    .object({
      outputFormat: z.enum(['plaintext', 'markdown']).default('markdown'),
      enabledPlugins: z.array(z.string()).default([]),
      summarizationThreshold: z.int().min(0).default(4),
    })
    .default({ outputFormat: 'markdown', enabledPlugins: [], summarizationThreshold: 4 }),
})

export type StoryMeta = z.infer<typeof StoryMetaSchema>

export const AssociationsSchema = z.object({
  tagIndex: z.record(z.string(), z.array(FragmentIdSchema)).default({}),
  refIndex: z.record(z.string(), z.array(FragmentIdSchema)).default({}),
})

export type Associations = z.infer<typeof AssociationsSchema>

// Prose chain entry represents a section with variations
export const ProseChainEntrySchema = z.object({
  proseFragments: z.array(FragmentIdSchema), // All variations/rewrites of this section
  active: FragmentIdSchema, // Currently active variation
})

export type ProseChainEntry = z.infer<typeof ProseChainEntrySchema>

// Prose chain represents the story's prose sections with versioning
export const ProseChainSchema = z.object({
  entries: z.array(ProseChainEntrySchema),
})

export type ProseChain = z.infer<typeof ProseChainSchema>
