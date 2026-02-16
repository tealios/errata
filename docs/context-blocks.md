# Context Block System

The context block system provides a structured, manipulable representation of the LLM prompt. Instead of building prompt strings imperatively, the generation pipeline creates discrete **blocks** that can be found, replaced, removed, reordered, and extended before compilation into final messages.

## Overview

The generation pipeline works in stages:

```
buildContextState() → beforeContext hooks → createDefaultBlocks() → beforeBlocks hooks → compileBlocks() → beforeGeneration hooks → streamText()
```

1. **`buildContextState()`** loads fragments from storage into a typed state object.
2. **`beforeContext`** hooks let plugins modify the state (add/remove fragments, change author input).
3. **`createDefaultBlocks()`** converts the state into an array of `ContextBlock` objects.
4. **`beforeBlocks`** hooks let plugins manipulate individual blocks (replace instructions, inject sections, reorder).
5. **`compileBlocks()`** groups blocks by role, sorts by order, and joins into `ContextMessage[]`.
6. **`beforeGeneration`** hooks operate on the final message strings.

## ContextBlock

```ts
interface ContextBlock {
  id: string                    // 'instructions', 'tools', 'prose', etc.
  role: 'system' | 'user'      // which LLM message this block belongs to
  content: string               // rendered text content
  order: number                 // sort key within role group
  source: 'builtin' | string   // 'builtin' for core blocks, plugin name for custom
}
```

## Source Markers

Each block's content begins with a `[@block=blockId]` marker that identifies it in the compiled prompt. These markers let the LLM (and debugging tools) trace which block produced a given section of text:

```
[@block=instructions]
You are a creative writing assistant...

[@block=tools]
## Available Tools
...

[@block=story-info]
## Story: My Story
...
```

Sub-sections within a block (e.g. Guidelines/Knowledge/Characters groupings inside `system-fragments` or `user-fragments`) use `[@section=Label]` markers instead. Fragment-level content uses `[@fragment=id]` and plugin tools use `[@plugin=name]`.

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

Order spacing of 100 leaves room for inserting custom blocks between existing ones.

## Block Manipulation Functions

All functions are pure and return new arrays (no mutation):

```ts
import {
  findBlock,
  replaceBlockContent,
  removeBlock,
  insertBlockBefore,
  insertBlockAfter,
  reorderBlock,
} from '@/server/llm/context-builder'

// Find a block by ID
const block = findBlock(blocks, 'instructions')

// Replace content of a specific block
const updated = replaceBlockContent(blocks, 'instructions', 'New instructions text')

// Remove a block entirely
const without = removeBlock(blocks, 'summary')

// Insert a new block before/after a target
const withExtra = insertBlockAfter(blocks, 'prose', {
  id: 'my-plugin-note',
  role: 'user',
  content: 'Remember: the narrator is unreliable.',
  order: 550,
  source: 'my-plugin',
})

// Change a block's sort order
const reordered = reorderBlock(blocks, 'author-input', 450)
```

When `insertBlockBefore` or `insertBlockAfter` can't find the target ID, the new block is appended to the end. The `order` field determines final position during `compileBlocks()`, not array position.

## Plugin Hook: `beforeBlocks`

Plugins can use the `beforeBlocks` hook to manipulate context blocks. This is the right abstraction for "modify the instructions", "inject a section", or "change how author input is presented".

```ts
import { definePlugin } from '@tealios/errata-plugin-sdk'
import type { ContextBlock } from '@tealios/errata-plugin-sdk'

export default definePlugin({
  manifest: {
    name: 'custom-instructions',
    version: '1.0.0',
    description: 'Replaces default writing instructions',
  },
  hooks: {
    beforeBlocks(blocks: ContextBlock[]): ContextBlock[] {
      // Replace the default instructions
      return replaceBlockContent(blocks, 'instructions',
        '[@block=instructions]\nYou are a poet. Write in iambic pentameter.'
      )
    },
  },
})
```

Import the manipulation functions from the SDK or use standard array operations:

```ts
hooks: {
  beforeBlocks(blocks) {
    // Remove the summary block
    let result = blocks.filter(b => b.id !== 'summary')

    // Add a custom block between prose and author input
    result = [
      ...result,
      {
        id: 'narrator-voice',
        role: 'user' as const,
        content: '\n[@block=narrator-voice]\nThe narrator speaks in second person.',
        order: 550,
        source: 'my-plugin',
      },
    ]

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
3. Joins block contents with `\n` within each group.
4. Returns one message per non-empty role group.

```ts
import { compileBlocks } from '@/server/llm/context-builder'

const messages = compileBlocks(blocks)
// [
//   { role: 'system', content: '...' },
//   { role: 'user', content: '...' },
// ]
```

## Choosing the Right Hook

| Want to... | Use |
|---|---|
| Modify which fragments are loaded | `beforeContext` (operates on `ContextBuildState`) |
| Change instructions, inject sections, reorder prompt structure | `beforeBlocks` (operates on `ContextBlock[]`) |
| Modify the final message strings | `beforeGeneration` (operates on `ContextMessage[]`) |
