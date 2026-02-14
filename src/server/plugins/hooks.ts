import type { WritingPlugin, GenerationResult } from './types'
import type { ContextBuildState, ContextMessage } from '../llm/context-builder'
import { createLogger } from '../logging'
import type { Fragment } from '../fragments/schema'

const logger = createLogger('plugin-hooks')

export async function runBeforeContext(
  plugins: WritingPlugin[],
  ctx: ContextBuildState,
): Promise<ContextBuildState> {
  if (plugins.length === 0) {
    return ctx
  }

  const requestLogger = logger.child({ storyId: ctx.story.id })
  requestLogger.info(`Running beforeContext hooks for ${plugins.length} plugin(s)`)

  let result = ctx
  for (const plugin of plugins) {
    if (plugin.hooks?.beforeContext) {
      const startTime = Date.now()
      requestLogger.debug(`Running beforeContext for plugin: ${plugin.manifest.name}`)
      result = await plugin.hooks.beforeContext(result)
      const durationMs = Date.now() - startTime
      requestLogger.debug(`beforeContext completed for plugin: ${plugin.manifest.name}`, { durationMs })
    }
  }
  return result
}

export async function runBeforeGeneration(
  plugins: WritingPlugin[],
  messages: ContextMessage[],
): Promise<ContextMessage[]> {
  if (plugins.length === 0) {
    return messages
  }

  logger.info(`Running beforeGeneration hooks for ${plugins.length} plugin(s)`)

  let result = messages
  for (const plugin of plugins) {
    if (plugin.hooks?.beforeGeneration) {
      const startTime = Date.now()
      logger.debug(`Running beforeGeneration for plugin: ${plugin.manifest.name}`)
      result = await plugin.hooks.beforeGeneration(result)
      const durationMs = Date.now() - startTime
      logger.debug(`beforeGeneration completed for plugin: ${plugin.manifest.name}`, { durationMs })
    }
  }
  return result
}

export async function runAfterGeneration(
  plugins: WritingPlugin[],
  genResult: GenerationResult,
): Promise<GenerationResult> {
  if (plugins.length === 0) {
    return genResult
  }

  logger.info(`Running afterGeneration hooks for ${plugins.length} plugin(s)`)

  let result = genResult
  for (const plugin of plugins) {
    if (plugin.hooks?.afterGeneration) {
      const startTime = Date.now()
      logger.debug(`Running afterGeneration for plugin: ${plugin.manifest.name}`)
      result = await plugin.hooks.afterGeneration(result)
      const durationMs = Date.now() - startTime
      logger.debug(`afterGeneration completed for plugin: ${plugin.manifest.name}`, { durationMs })
    }
  }
  return result
}

export async function runAfterSave(
  plugins: WritingPlugin[],
  fragment: Fragment,
  storyId: string,
): Promise<void> {
  if (plugins.length === 0) {
    return
  }

  const requestLogger = logger.child({ storyId })
  requestLogger.info(`Running afterSave hooks for ${plugins.length} plugin(s)`, { fragmentId: fragment.id })

  for (const plugin of plugins) {
    if (plugin.hooks?.afterSave) {
      const startTime = Date.now()
      requestLogger.debug(`Running afterSave for plugin: ${plugin.manifest.name}`)
      await plugin.hooks.afterSave(fragment, storyId)
      const durationMs = Date.now() - startTime
      requestLogger.debug(`afterSave completed for plugin: ${plugin.manifest.name}`, { durationMs })
    }
  }
}
