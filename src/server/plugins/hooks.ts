import type { WritingPlugin, PluginHooks, GenerationResult } from './types'
import type { ContextBuildState, ContextBlock, ContextMessage } from '../llm/context-builder'
import { createLogger, type Logger } from '../logging'
import type { Fragment } from '../fragments/schema'

const logger = createLogger('plugin-hooks')

/**
 * Generic plugin hook runner. Iterates enabled plugins, invokes the named hook
 * if present, times it, and logs. Returns the final accumulated value.
 *
 * Callers: the five public wrappers below.
 */
async function runHook<K extends keyof PluginHooks, T>(
  hookName: K,
  plugins: WritingPlugin[],
  initial: T,
  invoke: (hook: NonNullable<PluginHooks[K]>, value: T) => T | Promise<T>,
  log: Logger = logger,
): Promise<T> {
  if (plugins.length === 0) return initial

  log.info(`Running ${hookName} hooks for ${plugins.length} plugin(s)`)

  let result = initial
  for (const plugin of plugins) {
    const hook = plugin.hooks?.[hookName]
    if (!hook) continue
    const startTime = Date.now()
    log.debug(`Running ${hookName} for plugin: ${plugin.manifest.name}`)
    result = await invoke(hook as NonNullable<PluginHooks[K]>, result)
    const durationMs = Date.now() - startTime
    log.debug(`${hookName} completed for plugin: ${plugin.manifest.name}`, { durationMs })
  }
  return result
}

export async function runBeforeContext(
  plugins: WritingPlugin[],
  ctx: ContextBuildState,
): Promise<ContextBuildState> {
  return runHook(
    'beforeContext',
    plugins,
    ctx,
    // Cast needed: plugin SDK's ContextBuildState has a narrower StorySettings type
    // than the local one, but plugins pass through the full object unchanged.
    (hook, state) => hook(state as Parameters<typeof hook>[0]) as ContextBuildState | Promise<ContextBuildState>,
    logger.child({ storyId: ctx.story.id }),
  )
}

export async function runBeforeBlocks(
  plugins: WritingPlugin[],
  blocks: ContextBlock[],
): Promise<ContextBlock[]> {
  return runHook('beforeBlocks', plugins, blocks, (hook, value) => hook(value))
}

export async function runBeforeGeneration(
  plugins: WritingPlugin[],
  messages: ContextMessage[],
): Promise<ContextMessage[]> {
  return runHook('beforeGeneration', plugins, messages, (hook, value) => hook(value))
}

export async function runAfterGeneration(
  plugins: WritingPlugin[],
  genResult: GenerationResult,
): Promise<GenerationResult> {
  return runHook('afterGeneration', plugins, genResult, (hook, value) => hook(value))
}

export async function runAfterSave(
  plugins: WritingPlugin[],
  fragment: Fragment,
  storyId: string,
): Promise<void> {
  await runHook<'afterSave', null>(
    'afterSave',
    plugins,
    null,
    async (hook) => {
      await hook(fragment, storyId)
      return null
    },
    logger.child({ storyId }),
  )
}
