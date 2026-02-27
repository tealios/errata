import { z } from 'zod/v4'

export const FragmentIdSchema = z.string().regex(/^[a-z]{2,4}-[a-z0-9]{4,12}$/)

export const FRAGMENT_TYPES = ['prose', 'character', 'guideline', 'knowledge', 'image', 'icon', 'marker'] as const

export const FragmentTypeSchema = z.string().min(1)

export type FragmentType = z.infer<typeof FragmentTypeSchema>

export const FragmentSchema = z.object({
  id: FragmentIdSchema,
  type: FragmentTypeSchema,
  name: z.string().max(100),
  description: z.string().max(250),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  refs: z.array(FragmentIdSchema).default([]),
  sticky: z.boolean().default(false),
  placement: z.enum(['system', 'user']).default('user'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  order: z.int().default(0),
  meta: z.record(z.string(), z.unknown()).default({}),
  archived: z.boolean().default(false),
  version: z.int().min(1).default(1),
  versions: z.array(z.object({
    version: z.int().min(1),
    name: z.string().max(100),
    description: z.string().max(250),
    content: z.string(),
    createdAt: z.iso.datetime(),
    reason: z.string().optional(),
  })).default([]),
})

export interface FragmentVersion {
  version: number
  name: string
  description: string
  content: string
  createdAt: string
  reason?: string
}

export interface Fragment {
  id: string
  type: string
  name: string
  description: string
  content: string
  tags: string[]
  refs: string[]
  sticky: boolean
  placement: 'system' | 'user'
  createdAt: string
  updatedAt: string
  order: number
  meta: Record<string, unknown>
  archived?: boolean
  version?: number
  versions?: FragmentVersion[]
}

export const StoryMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  coverImage: z.string().nullable().default(null),
  summary: z.string().default(''),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  settings: z
    .object({
      outputFormat: z.enum(['plaintext', 'markdown']).default('markdown'),
      enabledPlugins: z.array(z.string()).default([]),
      summarizationThreshold: z.int().min(0).default(4),
      maxSteps: z.int().min(1).max(50).default(10),
      // Canonical model overrides map: { [roleKey]: { providerId?, modelId? } }
      modelOverrides: z.record(z.string(), z.object({
        providerId: z.string().nullable().optional(),
        modelId: z.string().nullable().optional(),
        temperature: z.number().min(0).max(2).nullable().optional(),
      })).default({}),
      // Legacy per-role fields (read for migration, no longer written)
      providerId: z.string().nullable().optional(),
      modelId: z.string().nullable().optional(),
      librarianProviderId: z.string().nullable().optional(),
      librarianModelId: z.string().nullable().optional(),
      characterChatProviderId: z.string().nullable().optional(),
      characterChatModelId: z.string().nullable().optional(),
      proseTransformProviderId: z.string().nullable().optional(),
      proseTransformModelId: z.string().nullable().optional(),
      librarianChatProviderId: z.string().nullable().optional(),
      librarianChatModelId: z.string().nullable().optional(),
      librarianRefineProviderId: z.string().nullable().optional(),
      librarianRefineModelId: z.string().nullable().optional(),
      directionsProviderId: z.string().nullable().optional(),
      directionsModelId: z.string().nullable().optional(),
      generationMode: z.enum(['standard', 'prewriter']).default('standard'),
      autoApplyLibrarianSuggestions: z.boolean().default(false),
      contextOrderMode: z.enum(['simple', 'advanced']).default('simple'),
      fragmentOrder: z.array(z.string()).default([]),
      enabledBuiltinTools: z.array(z.string()).optional(),
      contextCompact: z.object({
        type: z.enum(['proseLimit', 'maxTokens', 'maxCharacters']),
        value: z.number().int().min(1),
      }).default({ type: 'proseLimit', value: 10 }),
      summaryCompact: z.object({
        maxCharacters: z.number().int().min(100),
        targetCharacters: z.number().int().min(100),
      }).default({ maxCharacters: 12000, targetCharacters: 9000 }),
      enableHierarchicalSummary: z.boolean().default(false),
      guidedContinuePrompt: z.string().optional(),
      guidedSceneSettingPrompt: z.string().optional(),
      guidedSuggestPrompt: z.string().optional(),
    })
    .default({ outputFormat: 'markdown', enabledPlugins: [], summarizationThreshold: 4, maxSteps: 10, modelOverrides: {}, generationMode: 'standard', autoApplyLibrarianSuggestions: false, contextOrderMode: 'simple', fragmentOrder: [], enabledBuiltinTools: [], contextCompact: { type: 'proseLimit', value: 10 }, summaryCompact: { maxCharacters: 12000, targetCharacters: 9000 }, enableHierarchicalSummary: false }),
})

export type StoryMeta = z.infer<typeof StoryMetaSchema>

export const AssociationsSchema = z.object({
  tagIndex: z.record(z.string(), z.array(z.string())).default({}),
  refIndex: z.record(z.string(), z.array(z.string())).default({}),
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

// --- Branch schemas ---

export const BranchMetaSchema = z.object({
  id: z.string(),
  name: z.string().max(100),
  order: z.int().min(0),
  parentBranchId: z.string().optional(),
  forkAfterIndex: z.int().min(0).optional(),
  createdAt: z.iso.datetime(),
})

export type BranchMeta = z.infer<typeof BranchMetaSchema>

export const BranchesIndexSchema = z.object({
  branches: z.array(BranchMetaSchema),
  activeBranchId: z.string(),
})

export type BranchesIndex = z.infer<typeof BranchesIndexSchema>
