import { ToolLoopAgent, stepCountIs, type LanguageModel, type ToolSet } from 'ai'

export function createCharacterChatAgent(args: {
  model: LanguageModel
  instructions: string
  tools: ToolSet
  maxSteps: number
}) {
  return new ToolLoopAgent({
    model: args.model,
    instructions: args.instructions,
    tools: args.tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(args.maxSteps),
  })
}
