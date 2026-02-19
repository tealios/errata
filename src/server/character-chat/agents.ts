import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import type { AgentDefinition } from '../agents/types'
import { characterChat } from './chat'

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
  agentRegistry.register(chatDefinition)
  registered = true
}
