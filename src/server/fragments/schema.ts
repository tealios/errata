import { z } from 'zod/v4'

export const FragmentIdSchema = z.string().regex(/^[a-z]{2}-[a-z0-9]{4,8}$/)

export const FRAGMENT_TYPES = ['prose', 'character', 'guideline', 'knowledge'] as const

export const FragmentTypeSchema = z.enum(FRAGMENT_TYPES)

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
    })
    .default({ outputFormat: 'markdown', enabledPlugins: [] }),
})

export type StoryMeta = z.infer<typeof StoryMetaSchema>

export const AssociationsSchema = z.object({
  tagIndex: z.record(z.string(), z.array(FragmentIdSchema)).default({}),
  refIndex: z.record(z.string(), z.array(FragmentIdSchema)).default({}),
})

export type Associations = z.infer<typeof AssociationsSchema>
