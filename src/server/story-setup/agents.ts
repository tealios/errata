import { z } from 'zod/v4'
import { agentRegistry } from '../agents/registry'
import { ChatTranscriptMessageSchema } from '../agents/tool-record'
import { agentBlockRegistry } from '../agents/agent-block-registry'
import { modelRoleRegistry } from '../agents/model-role-registry'
import { instructionRegistry } from '../instructions'
import type { AgentDefinition } from '../agents/types'
import { STORY_SETUP_SYSTEM_PROMPT, buildStorySetupPreviewContext, createStorySetupBlocks } from './blocks'
import { storySetupChat } from './chat'

const StorySetupChatInputSchema = z.object({
  messages: z.array(ChatTranscriptMessageSchema),
})

declare module '../agents/agent-instance' {
  interface AgentInputMap {
    'story-setup.chat': z.infer<typeof StorySetupChatInputSchema>
  }
}

const chatDefinition: AgentDefinition<typeof StorySetupChatInputSchema> = {
  name: 'story-setup.chat',
  description: 'Open-ended conversation that helps a writer shape a new story.',
  inputSchema: StorySetupChatInputSchema,
  allowedCalls: [],
  run: async (ctx, input) => storySetupChat(ctx.dataDir, ctx.storyId, input),
}

let registered = false

export function registerStorySetupAgents(): void {
  if (registered) return

  instructionRegistry.registerDefault('story-setup.system', STORY_SETUP_SYSTEM_PROMPT)
  agentRegistry.register(chatDefinition)
  modelRoleRegistry.register({
    key: 'story-setup',
    label: 'Story Setup',
    description: 'Conversational planning for a new story',
  })
  agentBlockRegistry.register({
    agentName: 'story-setup.chat',
    displayName: 'Story Setup',
    description: 'Helps the writer shape an idea before creating starter fragments.',
    createDefaultBlocks: createStorySetupBlocks,
    availableTools: ['updateStorySetup'],
    buildPreviewContext: buildStorySetupPreviewContext,
  })

  registered = true
}

export const register = registerStorySetupAgents
