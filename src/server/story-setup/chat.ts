import { createStreamingRunner } from '../agents/create-streaming-runner'
import { tool } from 'ai'
import { toModelMessages, type ChatTranscriptMessage } from '../agents/tool-record'
import { StorySetupSnapshotSchema } from './schema'
import { listStorySetupFragmentContext, syncStorySetupSnapshot } from './sync'

export interface StorySetupChatOptions {
  messages: ChatTranscriptMessage[]
}

export const storySetupChat = createStreamingRunner<StorySetupChatOptions>({
  name: 'story-setup.chat',
  role: 'story-setup.chat',
  buildContext: false,
  readOnly: true,
  extraContext: async ({ dataDir, storyId }) => {
    const { setupFragments, referenceFragments } = await listStorySetupFragmentContext(dataDir, storyId)
    return {
      storySetupFragments: setupFragments,
      storySetupReferenceFragments: referenceFragments,
    }
  },
  tools: ({ dataDir, storyId }) => ({
    updateStorySetup: tool({
      description: 'Save the working story details and fragments, and replace the visible checklist before asking the writer the next question. Nothing is saved unless this call succeeds; if it returns an error, fix the input and call it again before replying.',
      inputSchema: StorySetupSnapshotSchema,
      execute: async ({ story, checklist, fragments }) => {
        const saved = await syncStorySetupSnapshot(dataDir, storyId, { story, fragments })
        return {
          saved: true,
          covered: checklist.filter(item => item.status === 'covered').length,
          checklist,
          story: saved.story,
          fragments: saved.fragments,
        }
      },
    }),
  }),
  toolChoice: 'auto',
  // Room for a failed save, a corrected retry, and the conversational reply.
  maxSteps: 5,
  messages: ({ opts }) => opts.messages.length > 0
    ? toModelMessages(opts.messages)
    : [{
        role: 'user',
        content: 'Begin the story setup conversation. Ask what starting point I have, and make it clear that an incomplete idea is welcome.',
      }],
})
