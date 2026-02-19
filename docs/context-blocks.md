# Context Block System

The context block system provides a structured, manipulable representation of the LLM prompt. Instead of building prompt strings imperatively, the generation pipeline creates discrete **blocks** that can be found, replaced, removed, reordered, and extended before compilation into final messages.

## Overview

The generation pipeline works in stages:

```
buildContextState() → beforeContext hooks → createDefaultBlocks() → applyBlockConfig() → beforeBlocks hooks → compileBlocks() → beforeGeneration hooks → streamText()
```

1. **`buildContextState()`** loads fragments from storage into a typed state object.
2. **`beforeContext`** hooks let plugins modify the state (add/remove fragments, change author input).
3. **`createDefaultBlocks()`** converts the state into an array of `ContextBlock` objects.
4. **`applyBlockConfig()`** applies the user's block configuration — custom blocks, content overrides, reordering, and disabling.
5. **`beforeBlocks`** hooks let plugins manipulate individual blocks (replace instructions, inject sections, reorder).
6. **`compileBlocks()`** prepends `[@block=id]` markers, groups blocks by role, sorts by order, and joins into `ContextMessage[]`.
7. **`beforeGeneration`** hooks operate on the final message strings.

## ContextBlock

```ts
interface ContextBlock {
  id: string                    // 'instructions', 'tools', 'prose', etc.
  name?: string                 // optional human-readable name (used in block markers)
  role: 'system' | 'user'      // which LLM message this block belongs to
  content: string               // text content (no [@block] marker — added by compileBlocks)
  order: number                 // sort key within role group
  source: 'builtin' | string   // 'builtin' for core blocks, plugin name for custom
}
```

## Source Markers

`compileBlocks()` automatically prepends a `[@block=...]` marker to each block's content during compilation. Block content itself should **not** include the marker. Blocks are separated by blank lines in the compiled output.

Two marker formats are used:

- `[@block=id]` — for blocks where `name` is absent or matches `id` (most builtin blocks)
- `[@block=slug src=id]` — for named blocks where `name` differs from `id`; `slug` is a lowercased, dash-separated version of the name

```
[@block=instructions]
You are a creative writing assistant...

[@block=tools]
## Available Tools
...

[@block=my-style-guide src=cb-a1b2c3]
Write in present tense, third person limited.
```

Other marker types used within block content:

- `[@section=Label]` — sub-sections within a block (e.g. Guidelines/Knowledge/Characters groupings inside `system-fragments` or `user-fragments`)
- `[@fragment=id]` — individual fragment content
- `[@plugin=name]` — plugin-contributed tool descriptions

## Default Blocks

`createDefaultBlocks()` produces these blocks. Empty sections are omitted.

| Block ID | Role | Order | Content |
|---|---|---|---|
| `instructions` | system | 100 | Writing assistant instructions |
| `tools` | system | 200 | Available tools listing |
| `system-fragments` | system | 300 | System-placed sticky fragments |
| `story-info` | user | 100 | Story name + description |
| `summary` | user | 200 | Story summary (omitted if empty) |
| `user-fragments` | user | 300 | User-placed sticky fragments |
| `shortlist-guidelines` | user | 400 | Non-sticky guideline shortlist |
| `shortlist-knowledge` | user | 410 | Non-sticky knowledge shortlist |
| `shortlist-characters` | user | 420 | Non-sticky character shortlist |
| `prose` | user | 500 | Recent prose chain |
| `author-input` | user | 600 | Author's direction |

Order gaps of 100 leave room for inserting custom blocks between existing ones.

## Block Manipulation

Six utility functions are exported from `@tealios/errata-plugin-sdk`. All are pure and return new arrays:

```ts
import {
  findBlock,
  replaceBlockContent,
  removeBlock,
  insertBlockBefore,
  insertBlockAfter,
  reorderBlock,
} from '@tealios/errata-plugin-sdk'

findBlock(blocks, 'instructions')                        // ContextBlock | undefined
replaceBlockContent(blocks, 'instructions', 'new text')  // ContextBlock[]
removeBlock(blocks, 'summary')                           // ContextBlock[]
insertBlockBefore(blocks, 'prose', newBlock)              // ContextBlock[]
insertBlockAfter(blocks, 'prose', newBlock)               // ContextBlock[]
reorderBlock(blocks, 'author-input', 450)                // ContextBlock[]
```

When `insertBlockBefore`/`insertBlockAfter` can't find the target ID, the new block is appended to the end. The `order` field determines final position during `compileBlocks()`, not array position.

## Plugin Hook: `beforeBlocks`

Plugins can use the `beforeBlocks` hook to manipulate context blocks. This is the right abstraction for modifying instructions, injecting sections, or changing how author input is presented.

The hook receives a `ContextBlock[]` and must return a (possibly modified) `ContextBlock[]`. Use the SDK helpers or standard array operations.

### Replace block content

```ts
import { definePlugin, replaceBlockContent } from '@tealios/errata-plugin-sdk'
import type { ContextBlock } from '@tealios/errata-plugin-sdk'

export default definePlugin({
  manifest: {
    name: 'custom-instructions',
    version: '1.0.0',
    description: 'Replaces default writing instructions',
  },
  hooks: {
    beforeBlocks(blocks: ContextBlock[]): ContextBlock[] {
      return replaceBlockContent(blocks, 'instructions',
        'You are a poet. Write in iambic pentameter.'
      )
    },
  },
})
```

### Remove a block and inject a new one

```ts
import { removeBlock, insertBlockAfter } from '@tealios/errata-plugin-sdk'

// in hooks:
hooks: {
  beforeBlocks(blocks) {
    let result = removeBlock(blocks, 'summary')

    result = insertBlockAfter(result, 'prose', {
      id: 'narrator-voice',
      role: 'user' as const,
      content: 'The narrator speaks in second person.',
      order: 550,
      source: 'my-plugin',
    })

    return result
  },
}
```

### Hook execution order

When multiple plugins define `beforeBlocks`, they run in sequence (order determined by plugin registration). Each plugin receives the blocks returned by the previous one.

## Compilation

`compileBlocks()` produces the final `ContextMessage[]`:

1. Separates blocks into `system` and `user` groups by `role`.
2. Sorts each group by `order` (stable sort).
3. Prepends `[@block=...]` marker to each block's content (see [Source Markers](#source-markers)).
4. Joins rendered blocks with `\n\n` (blank line separator) within each group.
5. Returns one message per non-empty role group.

```ts
import { compileBlocks } from '@/server/llm/context-builder'

const messages = compileBlocks(blocks)
// [
//   { role: 'system', content: '[@block=instructions]\n...\n\n[@block=tools]\n...' },
//   { role: 'user', content: '[@block=story-info]\n...\n\n[@block=prose]\n...' },
// ]
```

## Choosing the Right Hook

| Want to... | Use |
|---|---|
| Modify which fragments are loaded | `beforeContext` (operates on `ContextBuildState`) |
| Change instructions, inject sections, reorder prompt structure | `beforeBlocks` (operates on `ContextBlock[]`) |
| Modify the final message strings | `beforeGeneration` (operates on `ContextMessage[]`) |

---

# Block Editor & Custom Blocks

The Block Editor is a UI panel that gives users full control over the LLM context structure — without writing plugins. Users can disable builtin blocks, override their content, create custom blocks (including dynamic script blocks), and reorder everything via drag-and-drop.

The Block Editor is accessible from the sidebar under **Management > Block Editor** when **Prompt control** is set to **Advanced** in Settings. The Fragment Order panel (for ordering pinned fragments within blocks) is also gated behind this setting.

## How It Works

Every generation request produces a set of **default blocks** from story data (see [Default Blocks](#default-blocks) above). The Block Editor stores a per-story **block configuration** that is applied on top of those defaults during every generation. The configuration is applied after `createDefaultBlocks()` and before plugin `beforeBlocks` hooks, so plugins always see the user's customizations.

```
createDefaultBlocks(state) → applyBlockConfig(blocks, config, state) → beforeBlocks hooks → compileBlocks()
```

The configuration is stored as a JSON file at `data/stories/<storyId>/block-config.json`.

## Block Configuration

The block config has three parts:

```ts
interface BlockConfig {
  customBlocks: CustomBlockDefinition[]   // user-created blocks
  overrides: Record<string, BlockOverride> // per-block overrides (keyed by block ID)
  blockOrder: string[]                     // all block IDs in desired order
}
```

### Custom Block Definitions

Custom blocks are user-created content blocks injected into the LLM context alongside builtin blocks.

```ts
interface CustomBlockDefinition {
  id: string              // "cb-a1b2c3" — auto-generated, pattern: cb-{4-12 alphanumeric}
  name: string            // display name (1-100 chars)
  role: 'system' | 'user' // which LLM message this block belongs to
  order: number           // default sort position (used when blockOrder is empty)
  enabled: boolean        // can be toggled off without deleting
  type: 'simple' | 'script' // evaluation mode
  content: string         // plain text or JavaScript function body
}
```

There are two types of custom blocks:

#### Simple blocks

Plain text injected as-is into the context. Use these for static instructions, world-building notes, style guides, or any fixed content you want the LLM to see.

**Examples:**

- A writing style directive: *"Write in present tense, third person limited. Keep paragraphs short — 2-3 sentences max."*
- World rules: *"Magic in this world requires spoken incantations. Silent casting is impossible. All spells have a physical cost proportional to their power."*
- Tone guidance: *"The tone is darkly comedic. The narrator is unreliable and occasionally breaks the fourth wall."*

#### Script blocks

JavaScript function bodies that execute at generation time with access to the full story context. The content is evaluated as `new Function('ctx', content)` — write it as a function body that receives a `ctx` parameter and **returns a string**.

The `ctx` object contains:

| Field | Type | Description |
|---|---|---|
| `ctx.story` | `StoryMeta` | Story metadata (name, description, summary, settings) |
| `ctx.proseFragments` | `Fragment[]` | Recent prose fragments included in context |
| `ctx.stickyGuidelines` | `Fragment[]` | Pinned guideline fragments |
| `ctx.stickyKnowledge` | `Fragment[]` | Pinned knowledge fragments |
| `ctx.stickyCharacters` | `Fragment[]` | Pinned character fragments |
| `ctx.guidelineShortlist` | `Fragment[]` | Non-pinned guidelines (shown as shortlist) |
| `ctx.knowledgeShortlist` | `Fragment[]` | Non-pinned knowledge (shown as shortlist) |
| `ctx.characterShortlist` | `Fragment[]` | Non-pinned characters (shown as shortlist) |
| `ctx.authorInput` | `string` | The author's current input/direction |

**Return value:** The function must return a `string`. If it returns a non-string, an empty string, or a whitespace-only string, the block is silently omitted from context. If the script throws an error, the block is included with a `[Script error in custom block "name"]` placeholder so the user can see something went wrong.

**Script examples:**

Word count tracker:
```js
const total = ctx.proseFragments.reduce((n, f) => n + f.content.split(/\s+/).length, 0)
return `Current story length: approximately ${total} words.`
```

Dynamic character reminder:
```js
const names = ctx.stickyCharacters.map(c => c.name).join(', ')
if (!names) return ''
return `Active characters in this scene: ${names}. Stay consistent with their established voices and mannerisms.`
```

Conditional pacing note:
```js
const proseCount = ctx.proseFragments.length
if (proseCount < 3) return 'This is early in the story. Focus on establishing setting and character.'
if (proseCount > 15) return 'The story is well underway. Begin moving toward resolution of active conflicts.'
return ''
```

Summary-aware context:
```js
if (!ctx.story.summary) return ''
const words = ctx.story.summary.split(/\s+/).length
return `Story summary (${words} words) is available. Avoid contradicting established events.`
```

Input-aware formatting:
```js
if (ctx.authorInput.toLowerCase().includes('dialogue')) {
  return 'The author wants dialogue. Use varied dialogue tags, show character emotion through action beats, and avoid long unbroken speeches.'
}
return ''
```

### Block Overrides

Overrides modify builtin blocks (or custom blocks) without replacing them entirely. They are keyed by block ID.

```ts
interface BlockOverride {
  enabled?: boolean                                    // false to exclude from context
  order?: number                                       // override sort position
  contentMode?: 'override' | 'prepend' | 'append' | null // how to modify content
  customContent?: string                                // the content to use with contentMode
}
```

#### Content modes

| Mode | Effect |
|---|---|
| `null` / not set | No content modification — block uses its default content |
| `'prepend'` | `customContent` is inserted **before** the block's default content, separated by a newline |
| `'append'` | `customContent` is inserted **after** the block's default content, separated by a newline |
| `'override'` | The block's default content is **entirely replaced** with `customContent` |

Content modes are useful for tweaking builtin blocks without fully replacing them. For example:

- **Prepend** extra rules to `instructions`: *"IMPORTANT: Never use the word 'suddenly'."*
- **Append** a note to `story-info`: *"This is a noir detective story set in 1940s Chicago."*
- **Override** `instructions` entirely with your own system prompt.

### Block Order

`blockOrder` is a flat array of block IDs representing the desired ordering. When present, blocks are assigned position-based order values (0, 1, 2, ...) matching their position in the array. Blocks not in the array keep their default order values.

Since `compileBlocks()` sorts system and user blocks independently by `order`, the block order controls the sequence within each role group. Drag-and-drop in the Block Editor updates this array.

## Application Order

`applyBlockConfig()` processes the configuration in five steps, in this order:

1. **Evaluate and insert custom blocks** — enabled custom blocks are evaluated (simple: content as-is; script: executed with `ctx`) and added to the block list.
2. **Apply content overrides** — for each block with a `contentMode` override, the content is modified (prepend/append/override).
3. **Apply `blockOrder`** — blocks listed in `blockOrder` get position-based order values.
4. **Apply individual `order` overrides** — per-block `order` overrides take final precedence.
5. **Remove disabled blocks** — blocks with `enabled: false` overrides are filtered out.

This order means:
- Content overrides apply to the original block content (not reordered content).
- `blockOrder` drag-and-drop ordering is the primary ordering mechanism.
- Per-block `order` overrides can fine-tune positions beyond what drag-and-drop provides.
- Disabling happens last, so a disabled block's content is never evaluated for overrides.

## API Endpoints

All endpoints are under `/api/stories/:storyId/blocks`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/blocks` | Returns the block config and builtin block metadata (id, role, order, source, content preview) |
| `GET` | `/blocks/preview` | Compiles the full context with config applied and returns the resulting messages |
| `POST` | `/blocks/custom` | Creates a new custom block (body: `CustomBlockDefinition`) |
| `PUT` | `/blocks/custom/:blockId` | Updates a custom block (body: partial fields) |
| `DELETE` | `/blocks/custom/:blockId` | Deletes a custom block and cleans up its overrides/ordering |
| `PATCH` | `/blocks/config` | Updates overrides and/or block order (body: `{ overrides?, blockOrder? }`) |

### GET /blocks response

```json
{
  "config": {
    "customBlocks": [...],
    "overrides": { "instructions": { "enabled": false } },
    "blockOrder": ["tools", "instructions", ...]
  },
  "builtinBlocks": [
    { "id": "instructions", "role": "system", "order": 100, "source": "builtin", "contentPreview": "You are a creative..." },
    { "id": "tools", "role": "system", "order": 200, "source": "builtin", "contentPreview": "## Available Tools..." },
    ...
  ]
}
```

### GET /blocks/preview response

```json
{
  "messages": [
    { "role": "system", "content": "[@block=tools]\n## Available Tools..." },
    { "role": "user", "content": "[@block=story-info]\n## Story: ..." }
  ],
  "blockCount": 5
}
```

The preview endpoint builds the full context using `(preview)` as the author input, applies the block config, and compiles. This is what the Preview dialog in the Block Editor shows.

## Storage

Block configuration is stored at:

```
data/stories/<storyId>/block-config.json
```

The file is created on first write. If it doesn't exist, all functions return an empty default config (`{ customBlocks: [], overrides: {}, blockOrder: [] }`), meaning no modifications are applied and the default blocks pass through unchanged.

Storage functions (`src/server/blocks/storage.ts`):

| Function | Description |
|---|---|
| `getBlockConfig(dataDir, storyId)` | Read config, returns empty default if missing |
| `saveBlockConfig(dataDir, storyId, config)` | Write full config |
| `addCustomBlock(dataDir, storyId, block)` | Add a custom block and append its ID to `blockOrder` |
| `updateCustomBlock(dataDir, storyId, blockId, updates)` | Partial update of a custom block (returns `null` if not found) |
| `deleteCustomBlock(dataDir, storyId, blockId)` | Remove custom block + clean up its override and order entries |
| `updateBlockOverrides(dataDir, storyId, overrides, blockOrder?)` | Merge overrides and optionally replace `blockOrder` |

## UI: Block Editor Panel

The Block Editor panel is in the sidebar under **Management** (requires **Prompt control → Advanced** in Settings). It shows a unified list of all blocks (builtin + custom), merged and sorted by role then order.

### Block list

Each row shows:
- **Drag handle** — drag to reorder (updates `blockOrder`)
- **Name** — block ID for builtin blocks, custom name for custom blocks
- **Role badge** — `system` (violet) or `user` (blue)
- **Custom badge** — shown for custom blocks
- **Enable toggle** — green checkmark when enabled, click to toggle
- **Expand chevron** — click to expand the inline editor

### Builtin block editor (expanded)

When a builtin block is expanded:
1. A **content preview** shows the first 200 characters of the block's default content.
2. A **content mode selector** lets you choose None / Prepend / Append / Override.
3. When a mode is selected, a **textarea** appears for entering the custom content.

Changes save on blur (unfocus), not on every keystroke.

### Custom block editor (expanded)

When a custom block is expanded:
1. The block **type** is shown (simple / script).
2. A **textarea** for editing the block content (saves on blur).
3. A **Delete** button to remove the block.

### Creating custom blocks

Click **Add Custom Block** at the bottom to open the creation dialog:
- **Name** — display name for the block
- **Role** — system or user (determines which LLM message it goes in)
- **Type** — simple (plain text) or script (JavaScript with `ctx` access)
- **Content** — the block content or script body

## Interaction with Plugins

Block config is applied **before** plugin `beforeBlocks` hooks. This means:

- Users can disable a builtin block, and plugins won't see it.
- Users can override builtin content, and plugins will see the modified version.
- Custom blocks are visible to plugins and can be further modified by `beforeBlocks` hooks.
- Plugins can still add, remove, or modify any blocks regardless of user config.

If a plugin and user config both try to modify the same block, the user config runs first (content override), then the plugin hook runs on the result.

## Common Recipes

### Disable the tool listing

If your story doesn't need the LLM to use tools, disable the `tools` block to save context space.

### Override instructions for a specific genre

Use content mode **Override** on the `instructions` block to replace the default writing assistant prompt with genre-specific instructions.

### Add a "previously on..." recap

Create a **script** custom block in the `user` role:
```js
if (ctx.proseFragments.length === 0) return ''
const last = ctx.proseFragments[ctx.proseFragments.length - 1]
return `Previously: ${last.content.slice(0, 200)}...`
```

### Inject a style guide between story info and fragments

Create a **simple** custom block in the `user` role, then drag it between `story-info` and `user-fragments` in the block list.

### Conditionally include content based on story state

Create a **script** block that checks story data and returns content only when relevant:
```js
const hasCharacters = ctx.stickyCharacters.length > 0
if (!hasCharacters) return 'No characters have been defined yet. Introduce new characters naturally.'
return ''
```

## File Reference

| File | Purpose |
|---|---|
| `src/server/blocks/schema.ts` | Zod schemas for `BlockOverride`, `CustomBlockDefinition`, `BlockConfig` |
| `src/server/blocks/storage.ts` | File-based CRUD for block config |
| `src/server/blocks/apply.ts` | `applyBlockConfig()` — evaluates custom blocks, applies overrides/ordering/disabling. Script blocks receive a generic context object (not tied to `ContextBuildState`). |
| `src/server/api.ts` | API routes under `/stories/:storyId/blocks/*` and pipeline integration |
| `src/lib/api/blocks.ts` | Frontend API client |
| `src/lib/api/types.ts` | TypeScript types (`BlockConfig`, `CustomBlockDefinition`, `BlockOverride`, etc.) |
| `src/components/blocks/BlockEditorPanel.tsx` | Main panel component |
| `src/components/blocks/BlockCreateDialog.tsx` | Custom block creation dialog |
| `src/components/blocks/BlockPreviewDialog.tsx` | Context preview dialog |
| `tests/blocks/storage.test.ts` | Storage CRUD tests |
| `tests/blocks/apply.test.ts` | Config application logic tests |
| `tests/api/blocks-routes.test.ts` | API endpoint tests |

---

# Agent Block System

The **agent block system** extends the same block-based context approach to non-generation agents (librarian, character chat). Each agent registers block definitions that describe how to assemble its system prompt and user context from story data. Users can customize agent prompts through the same override mechanism used for generation blocks.

## How It Works

Agent blocks follow the same lifecycle as generation blocks, but for agent invocations:

```
AgentBlockContext → createDefaultBlocks() → applyBlockConfig() → compileBlocks() → agent.stream()
```

1. The calling agent builds an `AgentBlockContext` with relevant story data.
2. `compileAgentContext()` looks up the agent's registered block definitions, creates default blocks, applies per-story config overrides, and compiles into messages.
3. The compiled system/user messages and filtered tools are passed to `createToolAgent()`.

## AgentBlockContext

A superset context object that agents populate with the fields they need:

```ts
interface AgentBlockContext {
  story: StoryMeta
  proseFragments: Fragment[]
  stickyGuidelines: Fragment[]
  stickyKnowledge: Fragment[]
  stickyCharacters: Fragment[]
  guidelineShortlist: Fragment[]
  knowledgeShortlist: Fragment[]
  characterShortlist: Fragment[]
  systemPromptFragments: Fragment[]
  // Agent-specific fields (used by block builders that need them):
  allCharacters?: Fragment[]
  allKnowledge?: Fragment[]
  newProse?: { id: string; content: string }
  character?: Fragment
  personaDescription?: string
  targetFragment?: Fragment
  instructions?: string
  operation?: string
  guidance?: string
  selectedText?: string
  sourceContent?: string
  contextBefore?: string
  contextAfter?: string
  pluginToolDescriptions?: Array<{ name: string; description: string }>
}
```

## AgentBlockDefinition

Registered via `agentBlockRegistry.register()`:

```ts
interface AgentBlockDefinition {
  agentName: string
  displayName: string
  description: string
  createDefaultBlocks: (ctx: AgentBlockContext) => ContextBlock[]
  availableTools: string[]
  buildPreviewContext?: (dataDir: string, storyId: string) => Promise<AgentBlockContext>
}
```

## Registered Agents

| Agent Name | Display Name | Description |
|---|---|---|
| `librarian.analyze` | Librarian Analyze | Analyzes prose fragments for continuity signals |
| `librarian.chat` | Librarian Chat | Conversational assistant with write-enabled tools |
| `librarian.refine` | Librarian Refine | Refines non-prose fragments using story context |
| `librarian.prose-transform` | Prose Transform | Transforms selected prose spans |
| `character-chat.chat` | Character Chat | In-character conversation |

## Storage

Agent block configs are stored at:

```
data/stories/<storyId>/agent-blocks/<agentName>.json
```

Each config file follows the same `BlockConfig` schema (custom blocks, overrides, block order) plus an additional `disabledTools` array for filtering which tools the agent can use.

## API Endpoints

All endpoints are under `/api/stories/:storyId/agent-blocks`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/agent-blocks` | List all registered agents with their block definitions |
| `GET` | `/agent-blocks/:agentName` | Get agent block config, builtin blocks, and available tools |
| `GET` | `/agent-blocks/:agentName/preview` | Compile and preview the agent's full context |
| `PATCH` | `/agent-blocks/:agentName/config` | Update agent block config (overrides, blockOrder, disabledTools) |
| `POST` | `/agent-blocks/:agentName/custom` | Create a custom block for an agent |
| `PUT` | `/agent-blocks/:agentName/custom/:blockId` | Update a custom block |
| `DELETE` | `/agent-blocks/:agentName/custom/:blockId` | Delete a custom block |

## UI

The **Agent Context** panel is accessible from the sidebar under **Management** (requires **Prompt control → Advanced** in Settings). It allows browsing registered agents, viewing their compiled context, and customizing block overrides.

## File Reference

| File | Purpose |
|---|---|
| `src/server/agents/agent-block-context.ts` | `AgentBlockContext` type definition |
| `src/server/agents/agent-block-registry.ts` | Agent block definition registry |
| `src/server/agents/agent-block-storage.ts` | Per-agent block config storage |
| `src/server/agents/compile-agent-context.ts` | `compileAgentContext()` — assembles messages from blocks |
| `src/server/agents/create-agent.ts` | `createToolAgent()` — shared `ToolLoopAgent` wrapper |
| `src/server/agents/create-event-stream.ts` | `createEventStream()` — shared NDJSON stream builder |
| `src/server/agents/stream-types.ts` | `AgentStreamEvent`, `AgentStreamResult`, `ChatResult` types |
| `src/server/librarian/blocks.ts` | Block definitions for all librarian agents |
| `src/server/character-chat/blocks.ts` | Block definitions for character chat |
| `src/server/routes/agent-blocks.ts` | API routes |
| `src/lib/api/agent-blocks.ts` | Frontend API client |
| `src/components/agents/AgentContextPanel.tsx` | UI panel |
| `tests/agents/agent-block-storage.test.ts` | Storage tests |
| `tests/agents/agent-blocks.test.ts` | Block registration tests |
| `tests/agents/compile-agent-context.test.ts` | Context compilation tests |
