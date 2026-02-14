import type { WritingPlugin, GenerationResult } from './types'
import type { ContextBuildState, ContextMessage } from '../llm/context-builder'
import type { Fragment } from '../fragments/schema'

export async function runBeforeContext(
  plugins: WritingPlugin[],
  ctx: ContextBuildState,
): Promise<ContextBuildState> {
  let result = ctx
  for (const plugin of plugins) {
    if (plugin.hooks?.beforeContext) {
      result = await plugin.hooks.beforeContext(result)
    }
  }
  return result
}

export async function runBeforeGeneration(
  plugins: WritingPlugin[],
  messages: ContextMessage[],
): Promise<ContextMessage[]> {
  let result = messages
  for (const plugin of plugins) {
    if (plugin.hooks?.beforeGeneration) {
      result = await plugin.hooks.beforeGeneration(result)
    }
  }
  return result
}

export async function runAfterGeneration(
  plugins: WritingPlugin[],
  genResult: GenerationResult,
): Promise<GenerationResult> {
  let result = genResult
  for (const plugin of plugins) {
    if (plugin.hooks?.afterGeneration) {
      result = await plugin.hooks.afterGeneration(result)
    }
  }
  return result
}

export async function runAfterSave(
  plugins: WritingPlugin[],
  fragment: Fragment,
  storyId: string,
): Promise<void> {
  for (const plugin of plugins) {
    if (plugin.hooks?.afterSave) {
      await plugin.hooks.afterSave(fragment, storyId)
    }
  }
}
