import { agentBlockRegistry } from '../agents/agent-block-registry'
import { instructionRegistry } from '../instructions'
import type { AgentBlockContext } from '../agents/agent-block-context'
import { registry } from '../fragments/registry'
import { createDefaultBlocks, buildContextState, type ContextBuildState, type ContextBlock } from './context-builder'
import { createPrewriterBlocks, buildPrewriterPreviewContext, PREWRITER_INSTRUCTIONS } from './prewriter'
import {
  GENERATION_SYSTEM_PROMPT,
  GENERATION_TOOLS_SUFFIX,
  WRITER_BRIEF_SYSTEM_PROMPT,
  WRITER_BRIEF_TOOLS_SUFFIX,
} from './instruction-texts'

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

  // Register instruction defaults
  instructionRegistry.registerDefault('generation.system', GENERATION_SYSTEM_PROMPT)
  instructionRegistry.registerDefault('generation.tools-suffix', GENERATION_TOOLS_SUFFIX)
  instructionRegistry.registerDefault('generation.writer-brief.system', WRITER_BRIEF_SYSTEM_PROMPT)
  instructionRegistry.registerDefault('generation.writer-brief.tools-suffix', WRITER_BRIEF_TOOLS_SUFFIX)
  instructionRegistry.registerDefault('generation.prewriter.system', PREWRITER_INSTRUCTIONS)

  agentBlockRegistry.register({
    agentName: 'generation.writer',
    displayName: 'Writer',
    description: 'Prose continuation and generation',
    availableTools: getAvailableTools(),
    createDefaultBlocks: createGenerationBlocks,
    buildPreviewContext: buildGenerationPreviewContext,
  })

  agentBlockRegistry.register({
    agentName: 'generation.prewriter',
    displayName: 'Prewriter',
    description: 'Creates a focused writing brief from full story context.',
    availableTools: getAvailableTools(),
    createDefaultBlocks: createPrewriterBlocks,
    buildPreviewContext: buildPrewriterPreviewContext,
  })

  registered = true
}

/** Auto-discovery entry point */
export const register = registerGenerationBlocks
