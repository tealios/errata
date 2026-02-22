import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import { agentBlockRegistry } from '../agents/agent-block-registry'
import { modelRoleRegistry } from '../agents/model-role-registry'
import { instructionRegistry } from '../instructions'
import type { AgentDefinition } from '../agents/types'
import { characterChat } from './chat'
import { createCharacterChatBlocks, buildCharacterChatPreviewContext } from './blocks'

const PersonaModeSchema = z.union([
  z.object({ type: z.literal('character'), characterId: z.string() }),
  z.object({ type: z.literal('stranger') }),
  z.object({ type: z.literal('custom'), prompt: z.string() }),
])

const ChatInputSchema = z.object({
  characterId: z.string(),
  persona: PersonaModeSchema,
  storyPointFragmentId: z.string().nullable(),
  messages: z.array(z.object({
    role: z.union([z.literal('user'), z.literal('assistant')]),
    content: z.string(),
  })),
  maxSteps: z.int().positive().optional(),
})

declare module '../agents/agent-instance' {
  interface AgentInputMap {
    'character-chat.chat': z.infer<typeof ChatInputSchema>
  }
}

const chatDefinition: AgentDefinition<typeof ChatInputSchema> = {
  name: 'character-chat.chat',
  description: 'In-character conversation with a story character.',
  inputSchema: ChatInputSchema,
  allowedCalls: [],
  run: async (ctx, input) => {
    return characterChat(ctx.dataDir, ctx.storyId, input)
  },
}

let registered = false

export function registerCharacterChatAgents(): void {
  if (registered) return

  // Register instruction defaults
  instructionRegistry.registerDefault('character-chat.system', 'You are roleplaying as {{characterName}}. Stay in character at all times.')
  instructionRegistry.registerDefault('character-chat.instructions', [
    '1. Respond as {{characterName}} would, using their voice, mannerisms, and knowledge.',
    '2. You only know events up to the selected story point. Do not reference future events.',
    '3. You may use tools to look up fragment details when needed, but do NOT mention your use of tools in conversation.',
    '4. If asked about events beyond your knowledge cutoff, respond with genuine uncertainty — the character does not know.',
    '5. Stay in character. Do not break the fourth wall unless the character would.',
    '6. Keep responses natural and conversational.',
  ].join('\n'))
  instructionRegistry.registerDefault('character-chat.persona.character', 'You are speaking with {{personaName}}. {{personaDescription}}')
  instructionRegistry.registerDefault('character-chat.persona.stranger', 'You are speaking with a stranger you have just met. You do not know who they are.')
  instructionRegistry.registerDefault('character-chat.persona.custom', 'You are speaking with someone described as: {{prompt}}')

  // Agent definition
  agentRegistry.register(chatDefinition)

  // Model role (namespace-level — per-agent resolution via dot-separated names)
  modelRoleRegistry.register({ key: 'character-chat', label: 'Character Chat', description: 'In-character conversations' })

  // Block definition
  agentBlockRegistry.register({
    agentName: 'character-chat.chat',
    displayName: 'Character Chat',
    description: 'In-character conversation with a story character.',
    createDefaultBlocks: createCharacterChatBlocks,
    availableTools: [
      'getFragment', 'listFragments', 'searchFragments', 'listFragmentTypes',
    ],
    buildPreviewContext: buildCharacterChatPreviewContext,
  })

  registered = true
}

/** Auto-discovery entry point */
export const register = registerCharacterChatAgents
