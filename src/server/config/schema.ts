import { z } from 'zod/v4'

export const PROVIDER_PRESETS = {
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  anthropic: {
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5-20250929',
  },
  openrouter: {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat-v3-0324',
  },
  zai: {
    name: 'Z.AI',
    baseURL: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'glm-5',
  },
  custom: {
    name: 'Custom',
    baseURL: '',
    defaultModel: '',
  },
} as const

export type PresetId = keyof typeof PROVIDER_PRESETS

export const ProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  preset: z.string().default('custom'),
  baseURL: z.string().url(),
  apiKey: z.string().min(1),
  defaultModel: z.string().min(1),
  enabled: z.boolean().default(true),
  customHeaders: z.record(z.string(), z.string()).optional().default({}),
  temperature: z
    .union([z.number().min(0).max(2), z.null()])
    .optional()
    .transform((v) => v ?? undefined),
  createdAt: z.iso.datetime(),
})

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

/**
 * Network sharing: optional Basic Auth, LAN exposure, and a cloudflared tunnel.
 * LAN/tunnel are only honored when `authEnabled` is true — never expose the app
 * without a password.
 */
export const SharingConfigSchema = z
  .object({
    /** Gate. LAN + tunnel only take effect when this is on. */
    authEnabled: z.boolean().default(false),
    username: z.string().min(1).default('errata'),
    /** Salted hash as "salt:hash" (scrypt, hex). Empty string = no password set. */
    passwordHash: z.string().default(''),
    /** Expose an auth proxy on 0.0.0.0 for local-network access. */
    lanEnabled: z.boolean().default(false),
    /** Run a cloudflared quick tunnel for internet access (HTTPS). */
    tunnelEnabled: z.boolean().default(false),
  })
  .default({ authEnabled: false, username: 'errata', passwordHash: '', lanEnabled: false, tunnelEnabled: false })

export type SharingConfig = z.infer<typeof SharingConfigSchema>

export const GlobalConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).default([]),
  defaultProviderId: z.string().nullable().default(null),
  sharing: SharingConfigSchema,
})

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>
