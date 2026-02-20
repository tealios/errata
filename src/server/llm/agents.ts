import { agentBlockRegistry } from '../agents/agent-block-registry'
import type { AgentBlockContext } from '../agents/agent-block-context'
import { registry } from '../fragments/registry'
import { createDefaultBlocks, buildContextState, type ContextBuildState, type ContextBlock } from './context-builder'

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function pluralize(name: string): string {
  const massNouns = ['prose', 'knowledge']
  return massNouns.includes(name.toLowerCase()) ? name : name + 's'
}

function getAvailableTools(): string[] {
  const tools: string[] = []
  const types = registry.listTypes()
  for (const t of types) {
    if (t.llmTools === false) continue
    const cap = capitalize(t.type)
    const plural = capitalize(pluralize(t.type))
    tools.push(`get${cap}`)
    tools.push(`list${plural}`)
  }
  tools.push('getFragment', 'listFragments', 'searchFragments', 'listFragmentTypes')
  return tools
}

function createGenerationBlocks(ctx: AgentBlockContext): ContextBlock[] {
  const state: ContextBuildState = {
    story: ctx.story,
    proseFragments: ctx.proseFragments,
    chapterSummaries: [],
    stickyGuidelines: ctx.stickyGuidelines,
    stickyKnowledge: ctx.stickyKnowledge,
    stickyCharacters: ctx.stickyCharacters,
    guidelineShortlist: ctx.guidelineShortlist,
    knowledgeShortlist: ctx.knowledgeShortlist,
    characterShortlist: ctx.characterShortlist,
    authorInput: '(preview)',
  }
  const extraTools = ctx.pluginToolDescriptions?.map(t => ({
    name: t.name,
    description: t.description,
  }))
  return createDefaultBlocks(state, extraTools?.length ? { extraTools } : undefined)
}

async function buildGenerationPreviewContext(dataDir: string, storyId: string): Promise<AgentBlockContext> {
  const state = await buildContextState(dataDir, storyId, '(preview)')
  return {
    story: state.story,
    proseFragments: state.proseFragments,
    stickyGuidelines: state.stickyGuidelines,
    stickyKnowledge: state.stickyKnowledge,
    stickyCharacters: state.stickyCharacters,
    guidelineShortlist: state.guidelineShortlist,
    knowledgeShortlist: state.knowledgeShortlist,
    characterShortlist: state.characterShortlist,
    systemPromptFragments: [],
  }
}

let registered = false

export function registerGenerationBlocks(): void {
  if (registered) return

  agentBlockRegistry.register({
    agentName: 'generation',
    displayName: 'Writer',
    description: 'Prose continuation and generation',
    availableTools: getAvailableTools(),
    createDefaultBlocks: createGenerationBlocks,
    buildPreviewContext: buildGenerationPreviewContext,
  })

  registered = true
}

/** Auto-discovery entry point */
export const register = registerGenerationBlocks
