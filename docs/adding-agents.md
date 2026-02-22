# Adding a New Agent

This guide walks through adding a new agent to Errata. It covers the file structure, registration system, context assembly, streaming, model resolution, UI integration, and testing. The `librarian.optimize-character` agent (which rewrites character sheets using a creative writing methodology) is used as a running example.

## Overview

Agents are the backend workers that power Errata's LLM features — prose analysis, librarian chat, fragment refinement, character chat, and more. Each agent has:

- A **definition** (name, input schema, run function)
- **Context blocks** (system prompt + user context assembled from story data)
- A **model role** (determining which LLM provider/model is used)
- An **instruction key** (allowing users to override the system prompt per model)
- A **block definition** (enabling UI-based context customization)

Agents are auto-discovered at startup. The only convention required is exporting a `register` function from `src/server/<namespace>/agents.ts`.

## File Structure

Every agent namespace follows the same pattern:

```
src/server/<namespace>/
├── agents.ts              # Registration hub (auto-discovered)
├── blocks.ts              # System prompts and context block builders
├── <runner>.ts            # Runtime logic (e.g. chat.ts, refine.ts)
└── ...                    # Other files as needed
```

For the optimize-character agent, the files are:

| File | Purpose |
|---|---|
| `src/server/librarian/agents.ts` | Registration (modified — shared with other librarian agents) |
| `src/server/librarian/blocks.ts` | System prompt + block builder + preview context (modified) |
| `src/server/librarian/optimize-character.ts` | Runtime logic (new) |
| `src/components/agents/AgentContextPanel.tsx` | UI ordering (modified) |

If you're creating a brand new namespace (not adding to an existing one like `librarian`), you'd create a new directory under `src/server/`.

## Step 1: Define the System Prompt

The system prompt is the agent's core instructions. Define it as an exported constant in `blocks.ts`.

```ts
// src/server/librarian/blocks.ts

export const OPTIMIZE_CHARACTER_SYSTEM_PROMPT = `You are a character optimization agent...

## Methodology
...

## Instructions
1. Read the target character fragment using the appropriate get tool.
2. Read relevant prose fragments to understand how the character behaves.
3. Analyze gaps between the current sheet and the methodology.
4. Rewrite the character sheet with depth and causality.
5. Use updateFragment to save the improved version.
6. Explain what you changed and why.`
```

The prompt should be self-contained — the LLM receives it as the system message. It defines *what the agent does* and *how it should behave*.

## Step 2: Write the Block Builder

Block builders assemble the context the agent receives. Each builder takes an `AgentBlockContext` and returns an array of `ContextBlock` objects.

### Using composable block helpers

Most agents can be composed from reusable block helpers in `src/server/agents/block-helpers.ts`. Each helper produces a single `ContextBlock` (or `null` when the data is empty). Use `compactBlocks()` to filter out nulls:

```ts
import {
  instructionsBlock,
  storyInfoBlock,
  recentProseBlock,
  stickyFragmentsBlock,
  allCharactersBlock,
  targetFragmentBlock,
  compactBlocks,
} from '../agents/block-helpers'

export function createOptimizeCharacterBlocks(ctx: AgentBlockContext): ContextBlock[] {
  return compactBlocks([
    instructionsBlock('librarian.optimize-character.system', ctx),
    storyInfoBlock(ctx),
    recentProseBlock(ctx),
    stickyFragmentsBlock(ctx),
    allCharactersBlock(ctx),
    targetFragmentBlock(ctx,
      'character to optimize',
      'No specific instructions provided. Optimize this character for depth, causality, and friction using the methodology.',
    ),
  ])
}
```

This is equivalent to ~40 lines of manual block construction. Available helpers:

| Helper | Block ID | Role | Order | Description |
|---|---|---|---|---|
| `instructionsBlock(key, ctx)` | `instructions` | system | 100 | Resolved from instruction registry |
| `systemFragmentsBlock(ctx)` | `system-fragments` | system | 200 | Fragments tagged for system prompt |
| `storyInfoBlock(ctx)` | `story-info` | user | 100 | Story name, description, summary |
| `recentProseBlock(ctx)` | `prose` | user | 200 | Full content of recent prose |
| `proseSummariesBlock(ctx, header)` | `prose-summaries` | user | 200 | Truncated/summarized prose (for chat) |
| `stickyFragmentsBlock(ctx)` | `sticky-fragments` | user | 300 | Sticky guidelines, knowledge, characters |
| `allCharactersBlock(ctx)` | `all-characters` | user | 350 | All character IDs + names + descriptions |
| `shortlistBlock(ctx)` | `shortlist` | user | 400 | Non-sticky relevant fragments |
| `targetFragmentBlock(ctx, label, default)` | `target` | user | 400 | Target fragment + user instructions |

All conditional helpers (`recentProseBlock`, `stickyFragmentsBlock`, etc.) return `null` when their data is empty, so `compactBlocks` safely drops them.

### Manual block construction

For agents with unique context shapes (e.g. the analyze agent's per-fragment character/knowledge lists, or prose-transform's operation/selection blocks), construct blocks manually:

```ts
export function createLibrarianAnalyzeBlocks(ctx: AgentBlockContext): ContextBlock[] {
  const blocks: ContextBlock[] = []

  blocks.push(instructionsBlock('librarian.analyze.system', ctx))

  // Unique block shape — not covered by helpers
  blocks.push({
    id: 'story-summary',
    role: 'user',
    content: ['## Story Summary So Far', ctx.story.summary || '(No summary yet)'].join('\n'),
    order: 100,
    source: 'builtin',
  })

  // ... more custom blocks

  return blocks
}
```

You can freely mix helpers and manual blocks in the same builder.

### Block anatomy

Each block has:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique within this agent. Users reference this in overrides. |
| `role` | `'system' \| 'user'` | System blocks become the system message; user blocks become the user message. |
| `content` | `string` | The block's text content. |
| `order` | `number` | Sort order within the role group. Use gaps of 100 (100, 200, 300...) for custom block insertion room. |
| `source` | `'builtin'` | Always `'builtin'` for default blocks. |

### Conventions

- The first block should always be `id: 'instructions'` with `role: 'system'`, resolving from the instruction registry.
- Use `instructionRegistry.resolve(key, ctx.modelId)` (or the `instructionsBlock` helper) instead of the raw constant — this enables per-model overrides.
- `AgentBlockContext` is a superset type. Use only the fields your agent needs. If you need a new field, add it to the interface in `agent-block-context.ts`.
- System blocks appear before user blocks in the compiled output. Within each role, blocks are sorted by `order`.

### Preview context

Define a `buildPreviewContext` function that returns a plausible `AgentBlockContext` with placeholder values. This powers the "Preview" button in the Agent Context panel.

Use `buildBasePreviewContext()` to get the 8 common fields every preview context needs, then spread and add agent-specific extras:

```ts
import { buildBasePreviewContext } from '../agents/block-helpers'

export async function buildOptimizeCharacterPreviewContext(
  dataDir: string,
  storyId: string,
): Promise<AgentBlockContext> {
  const base = await buildBasePreviewContext(dataDir, storyId)
  const allCharacters = await listFragments(dataDir, storyId, 'character')
  return {
    ...base,
    allCharacters,
    targetFragment: undefined,
    instructions: '(Preview — actual instructions will appear during optimization)',
  }
}
```

`buildBasePreviewContext` handles `story`, `proseFragments`, all sticky/shortlist fields, and `systemPromptFragments: []`. If your agent needs system prompt fragments loaded, use `loadSystemPromptFragments()`:

```ts
export async function buildChatPreviewContext(dataDir: string, storyId: string): Promise<AgentBlockContext> {
  const base = await buildBasePreviewContext(dataDir, storyId)
  const systemPromptFragments = await loadSystemPromptFragments(dataDir, storyId, getFragmentsByTag, getFragment)
  return { ...base, systemPromptFragments }
}
```

## Step 3: Write the Runtime Logic

The runtime file is where the agent actually executes. Most streaming agents follow the same 14-step pipeline: validate story, resolve model, build context, compile blocks, create tools, stream result. The `createStreamingRunner` factory encodes this entire pipeline — you only provide the varying parts.

### Using the runner factory (recommended)

```ts
// src/server/librarian/optimize-character.ts

import { getFragment, listFragments } from '../fragments/storage'
import { createStreamingRunner } from '../agents/create-streaming-runner'
import type { AgentStreamResult } from '../agents/stream-types'

export interface OptimizeCharacterOptions {
  fragmentId: string
  instructions?: string
  maxSteps?: number
}

export type OptimizeCharacterResult = AgentStreamResult

export const optimizeCharacter = createStreamingRunner<OptimizeCharacterOptions>({
  name: 'librarian.optimize-character',
  readOnly: false,

  validate: async ({ dataDir, storyId, opts }) => {
    const fragment = await getFragment(dataDir, storyId, opts.fragmentId)
    if (!fragment) throw new Error(`Fragment ${opts.fragmentId} not found`)
    if (fragment.type !== 'character')
      throw new Error(`Fragment ${opts.fragmentId} is type "${fragment.type}", expected "character"`)
    return { fragment }
  },

  contextOptions: (opts) => ({ excludeFragmentId: opts.fragmentId }),

  extraContext: async ({ dataDir, storyId, validated, opts }) => ({
    allCharacters: await listFragments(dataDir, storyId, 'character'),
    targetFragment: validated.fragment,
    instructions: opts.instructions,
  }),
})
```

That's it — 31 lines for a complete streaming agent that validates input, resolves the model, builds context, compiles blocks, creates write-enabled fragment tools, and streams the result. Compare this to the ~100 lines the manual approach requires.

### Factory config reference

`createStreamingRunner<TOpts, TValidated>(config)` accepts:

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Agent name (used for logging, model role, block compilation) |
| `role` | `string` | `name` | Model role key (override if different from agent name) |
| `maxSteps` | `number` | `5` | Default max tool loop steps |
| `toolChoice` | `'auto' \| 'none'` | `'auto'` | Tool choice passed to the agent |
| `buildContext` | `boolean` | `true` | Whether to call `buildContextState`. Set `false` for agents that don't need story context |
| `readOnly` | `boolean \| 'none'` | `true` | `true` = read-only tools, `false` = read+write tools, `'none'` = no tools at all |
| `validate` | `(params) => Promise<TValidated>` | `() => {}` | Validate inputs, return data for later hooks. Throw to abort |
| `contextOptions` | `(opts) => Record<string, unknown>` | `() => {}` | Options passed to `buildContextState` (e.g. `excludeFragmentId`) |
| `extraContext` | `(params) => Partial<AgentBlockContext>` | `() => {}` | Agent-specific context merged into block context |
| `tools` | `(params) => ToolSet` | uses fragment tools | Custom tool set (receives pre-built `fragmentTools` for merging) |
| `messages` | `(params) => Array<{role, content}>` | single user message | Custom message array (for conversation history) |
| `afterStream` | `(result) => void` | none | Post-stream hook for logging or cleanup |

### Factory examples by pattern

**Read-only agent** (character chat — uses conversation history):

```ts
export const characterChat = createStreamingRunner<CharacterChatOptions>({
  name: 'character-chat.chat',
  role: 'character-chat.chat',
  readOnly: true,

  validate: async ({ dataDir, storyId, opts }) => {
    const character = await getFragment(dataDir, storyId, opts.characterId)
    if (!character || character.type !== 'character')
      throw new Error(`Character ${opts.characterId} not found`)
    // ... load persona character if applicable
    return { character, personaCharacterName, personaCharacterDescription }
  },

  contextOptions: (opts) => ({
    proseBeforeFragmentId: opts.storyPointFragmentId ?? undefined,
    summaryBeforeFragmentId: opts.storyPointFragmentId ?? undefined,
  }),

  extraContext: async ({ opts, validated, modelId }) => ({
    character: validated.character,
    personaDescription: buildPersonaDescription(opts.persona, validated.personaCharacterName, ...),
  }),

  // Override messages to pass conversation history instead of compiled user message
  messages: ({ opts }) =>
    opts.messages.map((m) => ({ role: m.role, content: m.content })),
})
```

**No-tools agent** (prose transform — single-shot, no context building):

```ts
export const transformProseSelection = createStreamingRunner<ProseTransformOptions>({
  name: 'librarian.prose-transform',
  role: 'librarian.prose-transform',
  maxSteps: 1,
  toolChoice: 'none',
  buildContext: false,      // Skip buildContextState entirely
  readOnly: 'none',         // No tools at all

  validate: async ({ dataDir, storyId, opts }) => {
    const fragment = await getFragment(dataDir, storyId, opts.fragmentId)
    // ... validate fragment, resolve guidance
    return { sourceContent, selectedText, guidance }
  },

  extraContext: async ({ opts, story, validated }) => ({
    operation: opts.operation,
    guidance: validated.guidance,
    selectedText: validated.selectedText,
    sourceContent: validated.sourceContent,
    contextBefore: opts.contextBefore,
    contextAfter: opts.contextAfter,
  }),

  afterStream: (result) => {
    result.completion.then((c) => {
      transformLogger.info('Prose transform completed', {
        stepCount: c.stepCount, finishReason: c.finishReason,
      })
    }).catch(() => {})
  },
})
```

### When NOT to use the factory

The factory works for agents that follow the standard streaming pipeline. Skip it when:

- The agent uses **inline tools** or **plugin integration** (librarian chat has both)
- The agent **doesn't stream** — it collects results and returns parsed JSON (directions suggest)
- The agent uses a **different context model** (generation uses `ContextBuildState` directly, not `AgentBlockContext`)

For these cases, write the pipeline manually. See `src/server/librarian/chat.ts` for the most complex manual example.

### Manual pipeline reference

For agents that need full manual control, the 14-step pipeline is:

```ts
import { getModel } from '../llm/client'
import { getStory, getFragment } from '../fragments/storage'
import { buildContextState } from '../llm/context-builder'
import { createFragmentTools } from '../llm/tools'
import { createToolAgent } from '../agents/create-agent'
import { createEventStream } from '../agents/create-event-stream'
import { compileAgentContext } from '../agents/compile-agent-context'
import { withBranch } from '../fragments/branches'

export async function myAgent(dataDir, storyId, opts): Promise<AgentStreamResult> {
  return withBranch(dataDir, storyId, async () => {
    // 1. Validate story
    const story = await getStory(dataDir, storyId)
    if (!story) throw new Error(`Story ${storyId} not found`)

    // 2. Validate agent-specific inputs
    const fragment = await getFragment(dataDir, storyId, opts.fragmentId)
    if (!fragment) throw new Error(`Fragment ${opts.fragmentId} not found`)

    // 3. Resolve model early (modelId needed for instruction resolution)
    const { model, modelId } = await getModel(dataDir, storyId, { role: 'my-agent' })

    // 4. Build story context
    const ctxState = await buildContextState(dataDir, storyId, '', { excludeFragmentId: opts.fragmentId })

    // 5. Assemble AgentBlockContext
    const blockContext: AgentBlockContext = {
      story: ctxState.story,
      proseFragments: ctxState.proseFragments,
      stickyGuidelines: ctxState.stickyGuidelines,
      stickyKnowledge: ctxState.stickyKnowledge,
      stickyCharacters: ctxState.stickyCharacters,
      guidelineShortlist: ctxState.guidelineShortlist,
      knowledgeShortlist: ctxState.knowledgeShortlist,
      characterShortlist: ctxState.characterShortlist,
      systemPromptFragments: [],
      targetFragment: fragment,
      modelId,
    }

    // 6. Create tools
    const allTools = createFragmentTools(dataDir, storyId, { readOnly: false })

    // 7. Compile context (block lifecycle: defaults → overrides → compile → filter tools)
    const compiled = await compileAgentContext(dataDir, storyId, 'my-agent', blockContext, allTools)

    // 8. Extract messages
    const systemMessage = compiled.messages.find(m => m.role === 'system')
    const userMessage = compiled.messages.find(m => m.role === 'user')

    // 9. Create agent
    const agent = createToolAgent({
      model,
      instructions: systemMessage?.content ?? '',
      tools: compiled.tools,
      maxSteps: opts.maxSteps ?? 5,
    })

    // 10. Stream
    const result = await agent.stream({
      messages: userMessage ? [{ role: 'user', content: userMessage.content }] : [],
    })

    return createEventStream(result.fullStream)
  })
}
```

### Key decisions in this pipeline

| Step | Why |
|---|---|
| `withBranch()` | Wraps execution in branch isolation so fragment writes are tracked |
| Model resolved early | `modelId` must be available when `compileAgentContext` calls `createDefaultBlocks`, which calls `instructionRegistry.resolve(key, modelId)` |
| `excludeFragmentId` | Prevents the target fragment from appearing in context twice — the agent reads it via tools instead |
| `compileAgentContext` | Handles the full block lifecycle: load block definition → `createDefaultBlocks()` → `applyBlockConfig()` (user overrides) → `compileBlocks()` → filter tools by `disabledTools` |
| `createEventStream` | Converts the AI SDK's `fullStream` into an NDJSON `ReadableStream<string>` + a `completion` promise |

### Read-only vs write-enabled tools

Pass `{ readOnly: true }` to `createFragmentTools()` (or `readOnly: true` in the factory config) for agents that only read data (analysis, suggestions). Pass `{ readOnly: false }` for agents that modify fragments (refine, optimize, chat). Write tools include `updateFragment`, `editFragment`, `createFragment`, `deleteFragment`, and `editProse`.

### Return type

All streaming agents return `AgentStreamResult`:

```ts
interface AgentStreamResult {
  eventStream: ReadableStream<string>   // NDJSON lines
  completion: Promise<AgentStreamCompletion>
}
```

The `eventStream` emits events of type `AgentStreamEvent`:

```ts
type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; toolName: string; result: unknown }
  | { type: 'finish'; finishReason: string; stepCount: number }
```

## Step 4: Register Everything

All registration happens in `agents.ts` inside a guarded `register()` function. If you're adding to an existing namespace (like `librarian`), modify the existing file. If creating a new namespace, create a new `src/server/<namespace>/agents.ts`.

### 4a. Input schema

Define a Zod schema for the agent's input. Uses `zod/v4` — use `z.int()` not `z.number().int()`.

```ts
const OptimizeCharacterInputSchema = z.object({
  fragmentId: z.string(),
  instructions: z.string().optional(),
  maxSteps: z.int().positive().optional(),
})
```

### 4b. Agent definition

Links the name, schema, and run function.

```ts
const optimizeCharacterDefinition: AgentDefinition<typeof OptimizeCharacterInputSchema> = {
  name: 'librarian.optimize-character',
  description: 'Optimize a character sheet using depth-focused writing methodology.',
  inputSchema: OptimizeCharacterInputSchema,
  run: async (ctx, input) => {
    return optimizeCharacter(ctx.dataDir, ctx.storyId, input)
  },
}
```

The `allowedCalls` field controls which other agents this one can invoke via `ctx.invokeAgent()`. Omitting it means no sub-agent calls allowed.

### 4c. Registration calls

Inside `registerLibrarianAgents()` (or your own `register()` function):

```ts
export function registerMyAgents(): void {
  if (registered) return

  // 1. Instruction default — system prompt text, keyed for override lookup
  instructionRegistry.registerDefault(
    'librarian.optimize-character.system',
    OPTIMIZE_CHARACTER_SYSTEM_PROMPT,
  )

  // 2. Agent definition — name, schema, run function
  agentRegistry.register(optimizeCharacterDefinition)

  // 3. Model role (namespace-level, once per namespace — skip if namespace already exists)
  // modelRoleRegistry.register({ key: 'my-namespace', label: '...', description: '...' })

  // 4. Block definition — context assembly + UI integration
  agentBlockRegistry.register({
    agentName: 'librarian.optimize-character',
    displayName: 'Librarian Optimize Character',
    description: 'Optimizes character sheets using depth-focused writing methodology.',
    createDefaultBlocks: createOptimizeCharacterBlocks,
    availableTools: [
      'getFragment', 'listFragments', 'searchFragments', 'listFragmentTypes',
      'createFragment', 'updateFragment', 'editFragment', 'deleteFragment',
      'editProse', 'getStorySummary', 'updateStorySummary',
    ],
    buildPreviewContext: buildOptimizeCharacterPreviewContext,
  })

  registered = true
}

// Auto-discovery entry point — MUST be named exactly `register`
export const register = registerMyAgents
```

### Auto-discovery

`src/server/agents/register-core.ts` uses `import.meta.glob('../*/agents.ts')` to find all agent modules at startup. The only requirement is:

1. Your file lives at `src/server/<anything>/agents.ts`
2. It exports `register` as a named export (a function with no arguments)

No manual import or registration list needed.

## Step 5: Expose via Chat (Optional)

If the agent should be callable from librarian chat (or any other conversational agent), add it as a tool in that agent's runtime:

```ts
// In chat.ts
const optimizeCharacterTool = tool({
  description: 'Optimize a character sheet using depth-focused writing methodology.',
  inputSchema: z.object({
    fragmentId: z.string().describe('The character fragment ID to optimize (e.g. ch-bakumo)'),
    instructions: z.string().optional().describe('Optional specific instructions'),
  }),
  execute: async ({ fragmentId, instructions }) => {
    const result = await optimizeCharacter(dataDir, storyId, { fragmentId, instructions })
    await result.completion
    return { ok: true, fragmentId }
  },
})

const allTools = { ...fragmentTools, optimizeCharacter: optimizeCharacterTool }
```

Also update the parent agent's registration:
- Add the new agent name to the parent's `allowedCalls` array
- Add the tool name to the parent's `availableTools` in its block definition
- Mention the tool in the parent's system prompt so the LLM knows it exists

## Step 6: UI Ordering

The Agent Context panel groups agents by namespace prefix and sorts them within each group. Two arrays in `AgentContextPanel.tsx` control this:

```ts
// Hierarchical groups
const AGENT_GROUPS: { label: string; prefix: string }[] = [
  { label: 'Generation', prefix: 'generation.' },
  { label: 'Directions', prefix: 'directions.' },
  { label: 'Librarian', prefix: 'librarian.' },
  { label: 'Character', prefix: 'character-chat.' },
]

// Sort order within each group
const AGENT_ORDER: string[] = [
  'generation.writer',
  'generation.prewriter',
  'directions.suggest',
  'librarian.analyze',
  'librarian.chat',
  'librarian.refine',
  'librarian.optimize-character',   // ← add new agent here
  'librarian.prose-transform',
  'character-chat.chat',
]
```

Agents not in `AGENT_ORDER` still appear — they sort to the end of their group. Agents whose prefix doesn't match any group appear under "Other". If you're creating a new namespace, add a new group entry.

## Model Resolution

Agent names double as model role keys. The resolution system uses a **dot-separated fallback chain**:

```
librarian.optimize-character →
  ['librarian.optimize-character', 'librarian', 'generation']
```

The chain is derived automatically by popping the last segment at each step, with `generation` always at the end. Resolution walks the chain looking for a configured provider:

1. **Story `modelOverrides`** — per-agent override in story settings
2. **Namespace default** — e.g. the `librarian` entry
3. **Global default** — the `generation` provider
4. **Error** — if nothing is configured

Only **namespace-level** roles need explicit registration in `modelRoleRegistry` (e.g. `librarian`, `character-chat`). Per-agent resolution happens automatically. Users configure namespace-level models in Settings and per-agent models in the Agent Context panel.

## Instruction Overrides

The instruction registry allows users to swap system prompts per model without changing code. When you register:

```ts
instructionRegistry.registerDefault('librarian.optimize-character.system', OPTIMIZE_CHARACTER_SYSTEM_PROMPT)
```

Users can create a JSON file at `data/instruction-sets/my-overrides.json`:

```json
{
  "name": "DeepSeek Character Optimization",
  "modelMatch": "/deepseek-.*/i",
  "priority": 50,
  "instructions": {
    "librarian.optimize-character.system": "Alternative prompt text for DeepSeek models..."
  }
}
```

When the agent runs with a DeepSeek model, `instructionRegistry.resolve(key, modelId)` returns the override instead of the default. See `docs/instruction-registry.md` for full details.

## Testing

### Block builder tests

Test that `createDefaultBlocks()` produces the expected blocks for various context shapes. No filesystem needed.

```ts
// tests/librarian/optimize-character-blocks.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { ensureCoreAgentsRegistered } from '@/server/agents'
import { agentBlockRegistry } from '@/server/agents/agent-block-registry'
import type { AgentBlockContext } from '@/server/agents/agent-block-context'

beforeEach(() => {
  ensureCoreAgentsRegistered()
})

describe('optimize-character blocks', () => {
  it('produces instructions and target blocks', () => {
    const ctx: AgentBlockContext = {
      story: makeStory(),
      proseFragments: [],
      stickyGuidelines: [],
      stickyKnowledge: [],
      stickyCharacters: [],
      guidelineShortlist: [],
      knowledgeShortlist: [],
      characterShortlist: [],
      systemPromptFragments: [],
      targetFragment: makeFragment({ id: 'ch-test', type: 'character', name: 'Hero' }),
      instructions: 'Focus on friction',
    }

    const def = agentBlockRegistry.get('librarian.optimize-character')
    const blocks = def!.createDefaultBlocks(ctx)

    expect(blocks.find(b => b.id === 'instructions')).toBeDefined()
    expect(blocks.find(b => b.id === 'target')).toBeDefined()
    expect(blocks.find(b => b.id === 'target')!.content).toContain('ch-test')
    expect(blocks.find(b => b.id === 'target')!.content).toContain('Focus on friction')
  })

  it('includes all-characters block when characters exist', () => {
    const ctx: AgentBlockContext = {
      story: makeStory(),
      proseFragments: [],
      stickyGuidelines: [],
      stickyKnowledge: [],
      stickyCharacters: [],
      guidelineShortlist: [],
      knowledgeShortlist: [],
      characterShortlist: [],
      systemPromptFragments: [],
      allCharacters: [
        makeFragment({ id: 'ch-a', name: 'Alice' }),
        makeFragment({ id: 'ch-b', name: 'Bob' }),
      ],
    }

    const def = agentBlockRegistry.get('librarian.optimize-character')
    const blocks = def!.createDefaultBlocks(ctx)

    const charBlock = blocks.find(b => b.id === 'all-characters')
    expect(charBlock).toBeDefined()
    expect(charBlock!.content).toContain('ch-a')
    expect(charBlock!.content).toContain('ch-b')
  })
})
```

### Registry count test

Update the existing test in `tests/agents/agent-blocks.test.ts` to include your new agent:

```ts
it('registers all N agents', () => {
  const agents = agentBlockRegistry.list()
  const names = agents.map(a => a.agentName)
  expect(names).toContain('librarian.optimize-character')
})
```

### Integration tests

For agents with complex runtime logic, write integration tests that mock `streamText`/`ToolLoopAgent` and verify context assembly. Use `createTempDir()` + `createStory()` for filesystem isolation. See `tests/librarian/refine.test.ts` and `tests/librarian/chat.test.ts` for patterns.

## Runner Safety

The agent runner (`src/server/agents/runner.ts`) enforces hard limits:

| Limit | Default | Description |
|---|---|---|
| `maxDepth` | 3 | Maximum nesting depth for agent-calls-agent chains |
| `maxCalls` | 20 | Maximum total agent invocations in a single root call |
| `timeoutMs` | 300,000 (5 min) | Wall-clock timeout for the entire call tree |

Cycle detection is stack-based — `A → B → A` throws immediately. The `allowedCalls` whitelist on the agent definition controls which sub-agents can be invoked.

## Checklist

When adding a new agent:

- [ ] Write the system prompt in `blocks.ts`
- [ ] Write the block builder using composable helpers (`compactBlocks([...])`) or manual construction
- [ ] Write the preview context using `buildBasePreviewContext()` + extras
- [ ] Write the runtime logic using `createStreamingRunner()` (or manual pipeline for complex agents)
- [ ] Define the input schema (Zod v4)
- [ ] Define the agent definition (`AgentDefinition`)
- [ ] Register in `agents.ts`: instruction default, agent definition, block definition
- [ ] Register model role if this is a new namespace (skip if namespace already exists)
- [ ] Export `register` from `agents.ts` (for auto-discovery, or modify existing `register`)
- [ ] (Optional) Add as a tool in a parent agent (chat tool, `allowedCalls`, `availableTools`, system prompt mention)
- [ ] Add to `AGENT_ORDER` in `AgentContextPanel.tsx`
- [ ] Add to `AGENT_GROUPS` if new namespace
- [ ] Write block builder tests
- [ ] Update registry count assertion in `agent-blocks.test.ts`
- [ ] Run `bun run test` — all tests pass

## File Reference

| File | Purpose |
|---|---|
| `src/server/agents/types.ts` | `AgentDefinition`, `AgentInvocationContext`, `AgentTraceEntry` |
| `src/server/agents/registry.ts` | Agent definition registry singleton |
| `src/server/agents/agent-block-registry.ts` | Agent block definition registry |
| `src/server/agents/agent-block-context.ts` | `AgentBlockContext` superset type |
| `src/server/agents/agent-block-storage.ts` | Per-agent block config persistence |
| `src/server/agents/compile-agent-context.ts` | `compileAgentContext()` — full block lifecycle |
| `src/server/agents/create-agent.ts` | `createToolAgent()` — AI SDK `ToolLoopAgent` wrapper |
| `src/server/agents/create-event-stream.ts` | `createEventStream()` — NDJSON stream builder |
| `src/server/agents/create-streaming-runner.ts` | `createStreamingRunner()` — standard pipeline factory |
| `src/server/agents/block-helpers.ts` | Composable block helpers and preview context utilities |
| `src/server/agents/stream-types.ts` | `AgentStreamEvent`, `AgentStreamResult` types |
| `src/server/agents/model-role-registry.ts` | Model role fallback chain registry |
| `src/server/agents/register-core.ts` | Auto-discovery via `import.meta.glob` |
| `src/server/agents/runner.ts` | Agent runner with depth/timeout/cycle enforcement |
| `src/server/instructions/registry.ts` | Instruction registry for prompt management |
| `src/server/llm/tools.ts` | `createFragmentTools()` — read/write tool generation |
| `src/server/llm/client.ts` | `getModel()` — model resolution with fallback chain |
| `src/server/llm/context-builder.ts` | `buildContextState()` — story context assembly |
| `src/server/fragments/branches.ts` | `withBranch()` — branch isolation wrapper |
| `src/components/agents/AgentContextPanel.tsx` | Agent panel UI ordering |
| `docs/context-blocks.md` | Agent block system reference (runtime details) |
| `docs/instruction-registry.md` | Instruction override system |
