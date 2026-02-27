import { ToolLoopAgent, stepCountIs, type LanguageModel, type ToolSet } from 'ai'

export function createWriterAgent(args: {
  model: LanguageModel
  tools: ToolSet
  maxSteps: number
  temperature?: number
}) {
  return new ToolLoopAgent({
    model: args.model,
    tools: args.tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(args.maxSteps),
    temperature: args.temperature,
  })
}
