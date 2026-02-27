import { ToolLoopAgent, stepCountIs, type LanguageModel, type ToolSet } from 'ai'

export function createToolAgent(args: {
  model: LanguageModel
  instructions: string
  tools: ToolSet
  maxSteps?: number
  toolChoice?: 'auto' | 'none'
  temperature?: number
}): ToolLoopAgent {
  return new ToolLoopAgent({
    model: args.model,
    instructions: args.instructions,
    tools: args.tools,
    toolChoice: args.toolChoice ?? 'auto',
    stopWhen: stepCountIs(args.maxSteps ?? 3),
    temperature: args.temperature,
  })
}
