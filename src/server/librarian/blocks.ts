import type { ContextBlock } from '../llm/context-builder'
import type { AgentBlockContext } from '../agents/agent-block-context'
import { getStory, listFragments, getFragment } from '../fragments/storage'
import { getFragmentsByTag } from '../fragments/associations'
import { buildContextState } from '../llm/context-builder'

// ─── Librarian Analyze ───

const ANALYZE_SYSTEM_PROMPT = `
You are a librarian agent for a collaborative writing app.
Your job is to analyze new prose fragments and maintain story continuity.

You have six reporting tools. Use them to report your findings:

1. updateSummary — Provide a concise summary of what happened in the new prose.
   - Also provide structured fields when possible: events[], stateChanges[], openThreads[].
   - If summary text is blank, structured fields are required.
2. reportMentions — Report each character reference by name, nickname, or title (not pronouns). Include the character ID and the exact text used.
3. reportContradictions — Flag when the new prose contradicts established facts in the summary, character descriptions, or knowledge. Only flag clear contradictions, not ambiguities.
4. suggestKnowledge — Suggest creating or updating character/knowledge fragments based on new information.
   - If an existing fragment should be refined, set targetFragmentId to that existing ID and provide the updated name/description/content.
   - If this is truly new information, omit targetFragmentId and suggest creating a new fragment.
   - Set type to "character" for characters or "knowledge" for world-building details, locations, items, or facts.
   - When updating a character or knowledge fragment, retain important established facts from the existing description in the updated content.
5. reportTimeline — Note significant events. "position" is relative to the previous prose: "before" if it's a flashback, "during" if concurrent, "after" if it follows sequentially.
6. suggestDirections — Suggest 3-5 possible directions the story could go next. Each direction needs a short title, a description of what would happen, and an instruction the writer could follow. Offer a mix: continue the current scene, introduce a twist, explore a character's inner thoughts, shift to a new setting, etc.

Always call updateSummary and suggestDirections. Only call the other tools if there are relevant findings.
If there are no contradictions, suggestions, mentions, or timeline events, don't call those tools.
Only return 'Analysis complete' in your final output.
`

export function createLibrarianAnalyzeBlocks(ctx: AgentBlockContext): ContextBlock[] {
  const blocks: ContextBlock[] = []

  blocks.push({
    id: 'instructions',
    role: 'system',
    content: ANALYZE_SYSTEM_PROMPT.trim(),
    order: 100,
    source: 'builtin',
  })

  if (ctx.systemPromptFragments.length > 0) {
    blocks.push({
      id: 'system-fragments',
      role: 'system',
      content: ctx.systemPromptFragments.map(frag => `## ${frag.name}\n${frag.content}`).join('\n\n'),
      order: 200,
      source: 'builtin',
    })
  }

  const summaryParts: string[] = []
  summaryParts.push('## Story Summary So Far')
  summaryParts.push(ctx.story.summary || '(No summary yet — this may be the beginning of the story.)')
  blocks.push({
    id: 'story-summary',
    role: 'user',
    content: summaryParts.join('\n'),
    order: 100,
    source: 'builtin',
  })

  if (ctx.allCharacters && ctx.allCharacters.length > 0) {
    blocks.push({
      id: 'characters',
      role: 'user',
      content: [
        '## Known Characters',
        ...ctx.allCharacters.map(c => `- ${c.id}: ${c.name} — ${c.description}`),
      ].join('\n'),
      order: 200,
      source: 'builtin',
    })
  }

  if (ctx.allKnowledge && ctx.allKnowledge.length > 0) {
    blocks.push({
      id: 'knowledge',
      role: 'user',
      content: [
        '## Knowledge Base',
        ...ctx.allKnowledge.map(k => `- ${k.id}: ${k.name} — ${k.content}`),
      ].join('\n'),
      order: 300,
      source: 'builtin',
    })
  }

  if (ctx.newProse) {
    blocks.push({
      id: 'new-prose',
      role: 'user',
      content: [
        '## New Prose Fragment',
        `Fragment ID: ${ctx.newProse.id}`,
        ctx.newProse.content,
      ].join('\n'),
      order: 400,
      source: 'builtin',
    })
  }

  return blocks
}

export async function buildAnalyzePreviewContext(dataDir: string, storyId: string): Promise<AgentBlockContext> {
  const story = await getStory(dataDir, storyId)
  if (!story) throw new Error(`Story ${storyId} not found`)

  const allCharacters = await listFragments(dataDir, storyId, 'character')
  const allKnowledge = await listFragments(dataDir, storyId, 'knowledge')

  const sysFragIds = await getFragmentsByTag(dataDir, storyId, 'pass-to-librarian-system-prompt')
  const systemPromptFragments = []
  for (const id of sysFragIds) {
    const frag = await getFragment(dataDir, storyId, id)
    if (frag) systemPromptFragments.push(frag)
  }

  return {
    story,
    proseFragments: [],
    stickyGuidelines: [],
    stickyKnowledge: [],
    stickyCharacters: [],
    guidelineShortlist: [],
    knowledgeShortlist: [],
    characterShortlist: [],
    systemPromptFragments,
    allCharacters,
    allKnowledge,
    newProse: { id: 'pr-preview', content: '(Preview — actual prose will appear here during analysis)' },
  }
}

// ─── Librarian Chat ───

const CHAT_SYSTEM_PROMPT = `
You are a conversational librarian assistant for a collaborative writing app. Your job is to help the author maintain story continuity by answering questions and performing fragment edits through tools.
Important: Follow the agent configuration.

Your tools:
- getFragment(id) — Read any fragment's full content. Use this to read prose before editing.
- editProse(oldText, newText) — Search and replace across active prose in the story chain. You must read the prose with getFragment first to know the exact text.
- editFragment(fragmentId, oldText, newText) — Search and replace within a specific non-prose fragment.
- updateFragment(fragmentId, newContent, newDescription) — Overwrite a fragment's entire content.
- createFragment(type, name, description, content) — Create a brand-new fragment.
- listFragments(type?) — List fragments, optionally by type.
- searchFragments(query, type?) — Search for text across all fragments.
- deleteFragment(fragmentId) — Delete a fragment.
- getStorySummary() — Read the current rolling story summary.
- updateStorySummary(summary) — Replace the story's rolling summary with a new version. Use this to rewrite, condense, or correct the summary based on all available prose.
- reanalyzeFragment(fragmentId) — Re-run librarian analysis on a prose fragment. Updates the fragment's summary, detects mentions, flags contradictions, and suggests knowledge. Use when the author asks to re-examine or reanalyze a specific prose section.

Instructions:
1. Your context includes a story summary and fragment summaries (IDs, names, descriptions) — not full content. Use getFragment(id) to read the full content of any fragment you need.
2. For prose edits, first read the relevant prose fragment with getFragment, then use editProse(oldText, newText) — it scans active prose automatically.
3. For character/guideline/knowledge changes, use editFragment or updateFragment with the fragment ID.
3b. When the author asks to add new lore/character/rules, use createFragment.
4. When the author asks for sweeping changes (e.g. "update all characters to reflect the time skip"), use listFragments and getFragment to find relevant fragments, then update each one.
5. Explain what you changed and why after making edits.
6. Ask clarifying questions when the request is ambiguous.
7. You can make multiple tool calls in sequence to accomplish complex tasks.
8. Keep fragment descriptions within the 250 character limit.
9. Be concise but thorough in your responses.

Fragment ID prefixes: pr- (prose), ch- (character), gl- (guideline), kn- (knowledge).
`

export function createLibrarianChatBlocks(ctx: AgentBlockContext): ContextBlock[] {
  const blocks: ContextBlock[] = []

  let chatSystemPrompt = CHAT_SYSTEM_PROMPT.trim()
  if (ctx.pluginToolDescriptions && ctx.pluginToolDescriptions.length > 0) {
    const pluginToolLines = ctx.pluginToolDescriptions.map(t => `- ${t.name} — ${t.description}`)
    chatSystemPrompt += `\n\nAdditional enabled plugin tools:\n${pluginToolLines.join('\n')}`
  }

  blocks.push({
    id: 'instructions',
    role: 'system',
    content: chatSystemPrompt,
    order: 100,
    source: 'builtin',
  })

  if (ctx.systemPromptFragments.length > 0) {
    blocks.push({
      id: 'system-fragments',
      role: 'system',
      content: ctx.systemPromptFragments.map(f => `- ${f.id}: ${f.name} — ${f.content}`).join('\n'),
      order: 200,
      source: 'builtin',
    })
  }

  // Story info
  const storyInfoParts: string[] = []
  storyInfoParts.push(`## Story: ${ctx.story.name}`)
  storyInfoParts.push(ctx.story.description)
  if (ctx.story.summary) {
    storyInfoParts.push(`\n## Story Summary\n${ctx.story.summary}`)
  }
  blocks.push({
    id: 'story-info',
    role: 'user',
    content: storyInfoParts.join('\n'),
    order: 100,
    source: 'builtin',
  })

  // Prose summaries
  if (ctx.proseFragments.length > 0) {
    const proseParts: string[] = ['## Prose Fragments (use getFragment to read/edit)']
    for (const p of ctx.proseFragments) {
      if ((p.meta._librarian as { summary?: string })?.summary) {
        proseParts.push(`- ${p.id}: ${(p.meta._librarian as { summary?: string }).summary ?? 'No summary available'}`)
      } else if (p.content.length < 600) {
        proseParts.push(`- ${p.id}: \n${p.content}`)
      } else {
        proseParts.push(`- ${p.id}: ${p.content.slice(0, 500).replace(/\n/g, ' ')}... [truncated]`)
      }
    }
    blocks.push({
      id: 'prose-summaries',
      role: 'user',
      content: proseParts.join('\n'),
      order: 200,
      source: 'builtin',
    })
  }

  // Sticky fragments
  const stickyAll = [
    ...ctx.stickyGuidelines,
    ...ctx.stickyKnowledge,
    ...ctx.stickyCharacters,
  ]
  if (stickyAll.length > 0) {
    blocks.push({
      id: 'sticky-fragments',
      role: 'user',
      content: [
        '## Active Context Fragments',
        ...stickyAll.map(f => `- ${f.id}: ${f.name} — ${f.description}`),
      ].join('\n'),
      order: 300,
      source: 'builtin',
    })
  }

  // Shortlists
  const shortlistAll = [
    ...ctx.guidelineShortlist,
    ...ctx.knowledgeShortlist,
    ...ctx.characterShortlist,
  ]
  if (shortlistAll.length > 0) {
    blocks.push({
      id: 'shortlist',
      role: 'user',
      content: [
        '## Other Available Fragments',
        ...shortlistAll.map(f => `- ${f.id}: ${f.name} — ${f.description}`),
      ].join('\n'),
      order: 400,
      source: 'builtin',
    })
  }

  return blocks
}

export async function buildChatPreviewContext(dataDir: string, storyId: string): Promise<AgentBlockContext> {
  const ctxState = await buildContextState(dataDir, storyId, '')

  const sysFragIds = await getFragmentsByTag(dataDir, storyId, 'pass-to-librarian-system-prompt')
  const systemPromptFragments = []
  for (const id of sysFragIds) {
    const frag = await getFragment(dataDir, storyId, id)
    if (frag) systemPromptFragments.push(frag)
  }

  return {
    story: ctxState.story,
    proseFragments: ctxState.proseFragments,
    stickyGuidelines: ctxState.stickyGuidelines,
    stickyKnowledge: ctxState.stickyKnowledge,
    stickyCharacters: ctxState.stickyCharacters,
    guidelineShortlist: ctxState.guidelineShortlist,
    knowledgeShortlist: ctxState.knowledgeShortlist,
    characterShortlist: ctxState.characterShortlist,
    systemPromptFragments,
  }
}

// ─── Librarian Refine ───

const REFINE_SYSTEM_PROMPT = `You are a fragment refinement agent for a collaborative writing app. Your job is to improve a specific fragment (character, guideline, or knowledge) based on the story context.

Instructions:
1. First, read the target fragment using the appropriate get tool (e.g. getCharacter, getKnowledge, getGuideline).
2. Analyze the story context provided: prose, summary, and other fragments.
3. Use the updateFragment or editFragment tool to improve the target fragment.
4. Explain what you changed and why in your text response.

Guidelines for refinement:
- If the user provides specific instructions, follow them precisely.
- If no instructions are given, improve the fragment for consistency, clarity, and depth based on story events.
- Preserve the fragment's existing voice and style unless asked otherwise.
- Update descriptions to stay within the 250 character limit.
- Do NOT delete fragments unless explicitly asked.
- Do NOT modify prose fragments — only characters, guidelines, and knowledge.`

export function createLibrarianRefineBlocks(ctx: AgentBlockContext): ContextBlock[] {
  const blocks: ContextBlock[] = []

  blocks.push({
    id: 'instructions',
    role: 'system',
    content: REFINE_SYSTEM_PROMPT,
    order: 100,
    source: 'builtin',
  })

  // Story info
  const storyInfoParts: string[] = []
  storyInfoParts.push(`## Story: ${ctx.story.name}`)
  storyInfoParts.push(ctx.story.description)
  if (ctx.story.summary) {
    storyInfoParts.push(`\n## Story Summary\n${ctx.story.summary}`)
  }
  blocks.push({
    id: 'story-info',
    role: 'user',
    content: storyInfoParts.join('\n'),
    order: 100,
    source: 'builtin',
  })

  // Recent prose
  if (ctx.proseFragments.length > 0) {
    blocks.push({
      id: 'prose',
      role: 'user',
      content: [
        '## Recent Prose',
        ...ctx.proseFragments.map(p => `### ${p.name} (${p.id})\n${p.content}`),
      ].join('\n'),
      order: 200,
      source: 'builtin',
    })
  }

  // Sticky fragments
  const stickyAll = [
    ...ctx.stickyGuidelines,
    ...ctx.stickyKnowledge,
    ...ctx.stickyCharacters,
  ]
  if (stickyAll.length > 0) {
    blocks.push({
      id: 'sticky-fragments',
      role: 'user',
      content: [
        '## Active Context Fragments',
        ...stickyAll.map(f => `- ${f.id}: ${f.name} — ${f.description}`),
      ].join('\n'),
      order: 300,
      source: 'builtin',
    })
  }

  // Target fragment + instructions
  if (ctx.targetFragment) {
    const targetParts: string[] = []
    targetParts.push(`Target fragment to refine: ${ctx.targetFragment.id} (type: ${ctx.targetFragment.type}, name: "${ctx.targetFragment.name}")`)
    if (ctx.instructions) {
      targetParts.push(`\nUser instructions: ${ctx.instructions}`)
    } else {
      targetParts.push('\nNo specific instructions provided. Improve this fragment based on recent story events for consistency, clarity, and depth.')
    }
    blocks.push({
      id: 'target',
      role: 'user',
      content: targetParts.join('\n'),
      order: 400,
      source: 'builtin',
    })
  }

  return blocks
}

export async function buildRefinePreviewContext(dataDir: string, storyId: string): Promise<AgentBlockContext> {
  const ctxState = await buildContextState(dataDir, storyId, '')

  return {
    story: ctxState.story,
    proseFragments: ctxState.proseFragments,
    stickyGuidelines: ctxState.stickyGuidelines,
    stickyKnowledge: ctxState.stickyKnowledge,
    stickyCharacters: ctxState.stickyCharacters,
    guidelineShortlist: ctxState.guidelineShortlist,
    knowledgeShortlist: ctxState.knowledgeShortlist,
    characterShortlist: ctxState.characterShortlist,
    systemPromptFragments: [],
    targetFragment: undefined,
    instructions: '(Preview — actual instructions will appear during refinement)',
  }
}

// ─── Prose Transform ───

const PROSE_TRANSFORM_SYSTEM_PROMPT = `You transform selected prose spans for an author in a writing app.

Rules:
- Follow the requested operation exactly.
- Preserve story facts, continuity, tense, and point of view.
- Do not add metadata, explanations, markdown, quotes, or labels.
- Return only the transformed replacement text for the selected span.`

export function createProseTransformBlocks(ctx: AgentBlockContext): ContextBlock[] {
  const blocks: ContextBlock[] = []

  blocks.push({
    id: 'instructions',
    role: 'system',
    content: PROSE_TRANSFORM_SYSTEM_PROMPT,
    order: 100,
    source: 'builtin',
  })

  if (ctx.operation) {
    blocks.push({
      id: 'operation',
      role: 'user',
      content: [
        `Operation: ${ctx.operation}`,
        ctx.guidance || '',
      ].join('\n').trim(),
      order: 100,
      source: 'builtin',
    })
  }

  blocks.push({
    id: 'story-summary',
    role: 'user',
    content: [
      'Story summary:',
      ctx.story.summary || '(none)',
    ].join('\n'),
    order: 200,
    source: 'builtin',
  })

  if (ctx.sourceContent) {
    blocks.push({
      id: 'source',
      role: 'user',
      content: [
        'Fragment context:',
        ctx.sourceContent,
      ].join('\n'),
      order: 300,
      source: 'builtin',
    })
  }

  if (ctx.selectedText) {
    blocks.push({
      id: 'selection',
      role: 'user',
      content: [
        'Selected span to transform:',
        ctx.selectedText,
        '',
        'Context before selected span:',
        ctx.contextBefore?.trim() || '(none)',
        '',
        'Context after selected span:',
        ctx.contextAfter?.trim() || '(none)',
      ].join('\n'),
      order: 400,
      source: 'builtin',
    })
  }

  return blocks
}

export async function buildProseTransformPreviewContext(dataDir: string, storyId: string): Promise<AgentBlockContext> {
  const story = await getStory(dataDir, storyId)
  if (!story) throw new Error(`Story ${storyId} not found`)

  return {
    story,
    proseFragments: [],
    stickyGuidelines: [],
    stickyKnowledge: [],
    stickyCharacters: [],
    guidelineShortlist: [],
    knowledgeShortlist: [],
    characterShortlist: [],
    systemPromptFragments: [],
    operation: 'rewrite',
    guidance: 'Rewrite the selected span for clarity and flow while preserving the original meaning and voice.',
    selectedText: '(Preview — actual selection will appear during transform)',
    sourceContent: '(Preview — actual fragment content will appear during transform)',
    contextBefore: '',
    contextAfter: '',
  }
}
