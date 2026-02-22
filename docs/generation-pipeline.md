# Generation Pipeline

## Overview

The generation endpoint (`POST /api/stories/:storyId/generate`) produces prose continuations via a streaming NDJSON response. It supports two modes controlled by the `generationMode` story setting:

- **Standard mode** (default): The writer agent sees the full compiled context and generates prose directly.
- **Prewriter mode** (`generationMode: 'prewriter'`): A two-phase pipeline where a prewriter agent first analyzes the full context and produces a focused writing brief, then the writer generates prose from a stripped-down context containing only recent prose and the brief.

## Standard Mode Flow

```
Author input
  → buildContextState()           Load fragments, apply prose limits
  → beforeContext hooks            Plugin transformations on context state
  → createDefaultBlocks()          Build all context blocks
  → applyBlockConfig()             Apply user block customizations
  → beforeBlocks hooks             Plugin transformations on blocks
  → compileBlocks()                Blocks → ContextMessage[]
  → beforeGeneration hooks         Plugin transformations on messages
  → addCacheBreakpoints()          Add Anthropic cache control hints
  → Writer agent streams prose     ToolLoopAgent with fragment tools
  → afterGeneration hooks          Plugin post-processing
  → Save fragment (versioned)      Create or add variation
  → afterSave hooks                Plugin post-save actions
  → Trigger librarian              Fire-and-forget analysis
```

The writer agent sees the complete context: system instructions, tool descriptions, story info, summaries, characters, guidelines, knowledge, shortlists, prose chain, and the author's input.

## Prewriter Mode Flow

Prewriter mode uses the same context build pipeline through `compileBlocks()`, then diverges:

```
[Same as standard through compileBlocks()]
  → Phase 1: Prewriter
      → compileAgentContext('generation.prewriter')
      → Inject full compiled context into prewriter blocks
      → Set mode-specific planning request
      → Prewriter agent streams brief        ToolLoopAgent
  → Phase 2: Writer
      → createWriterBriefBlocks()            Stripped context
      → Carry over: custom blocks, system fragments, sticky guidelines
      → Writer agent streams prose           ToolLoopAgent
  → [Same as standard: hooks → save → librarian]
```

### Why Two Phases?

The prewriter compresses the full context into a focused brief. This means:
- The writer's context window is smaller and more focused
- Character voices, scene details, and guidelines are distilled rather than raw
- The brief can be customized per generation (the prewriter adapts to generate/regenerate/refine modes)

## Prewriter Agent

The prewriter is registered as `generation.prewriter` in the agent block registry.

### Default Blocks

| Block ID | Role | Content |
|---|---|---|
| `instructions` | system | Resolved from `generation.prewriter.system` instruction key |
| `full-context` | user | Placeholder — replaced at runtime with the full compiled context |
| `planning-request` | user | Placeholder — replaced with mode-specific prompt |

### Mode-Specific Prompts

The `planning-request` block content varies by generation mode:

| Mode | Prompt summary |
|---|---|
| `generate` | "The author wants to CONTINUE the story. Their direction: ..." |
| `regenerate` | "The author wants to REGENERATE the latest passage. Their direction: ..." |
| `refine` | "The author wants to REFINE/EDIT the latest passage. Their direction: ..." |

### Tool Access

The prewriter has access to the same fragment tools as the writer (read-only + plugin tools), allowing it to look up specific fragments during planning. Tools can be disabled per-agent via the block editor.

### Customization

Prewriter blocks are customizable through the Agent Context panel (block editor at `generation.prewriter`). Users can add custom blocks, override instruction content, or reorder blocks.

## Writer Brief Context

In prewriter mode, the writer sees a stripped-down context instead of the full one:

| Block ID | Role | Content |
|---|---|---|
| `instructions` | system | Resolved from `generation.writer-brief.system` |
| `tools` | system | Tool descriptions + `generation.writer-brief.tools-suffix` |
| `prose` | user | Recent prose fragments (for continuity) |
| `writing-brief` | user | The prewriter's output |

Additionally, these blocks are carried over from the standard context:
- Custom blocks (`source: 'custom'`)
- System-placement fragments (`system-fragments` block)
- Sticky guideline blocks (IDs starting with `gl-`)
- Custom blocks from the prewriter's agent block config

### Standard vs Prewriter Comparison

| Context element | Standard mode | Prewriter mode |
|---|---|---|
| System instructions | Full `generation.system` | Condensed `generation.writer-brief.system` |
| Characters | Full character sheets | Distilled in brief |
| Guidelines | All sticky + shortlisted | Sticky carried over; rest distilled in brief |
| Knowledge | All sticky + shortlisted | Distilled in brief |
| Summary | Rolling summary block | Distilled in brief |
| Prose | Full chain (within limits) | Recent prose only |
| Author input | Direct | Embedded in brief's planning request |
| Tools | Full access | Full access (can still look up fragments) |

## Step Budget

The total step budget comes from `story.settings.maxSteps` (default 10) and is split between the two phases:

- **Prewriter**: `floor(maxSteps / 2)` steps (minimum 1)
- **Writer**: `maxSteps - prewriterStepCount` steps (minimum 1)

The writer gets back any unused prewriter steps. For example, if `maxSteps` is 10 and the prewriter uses 2 of its 5 allocated steps, the writer gets 8 steps.

## Streaming Events

The generation endpoint streams NDJSON (one JSON object per line). Event types:

| Event type | Fields | Description |
|---|---|---|
| `phase` | `phase: 'prewriting' \| 'writing'` | Phase transition (prewriter mode only) |
| `prewriter-text` | `text: string` | Prewriter text delta (prewriter mode only) |
| `text` | `text: string` | Writer text delta |
| `reasoning` | `text: string` | Model reasoning/thinking delta |
| `tool-call` | `id`, `toolName`, `args` | Tool invocation |
| `tool-result` | `id`, `toolName`, `result` | Tool execution result |
| `finish` | `finishReason`, `stepCount`, `stopped?` | Stream complete |

In prewriter mode, events flow in order: `phase:prewriting` → prewriter events (`prewriter-text`, `reasoning`, `tool-call`, `tool-result`) → `phase:writing` → writer events (`text`, `reasoning`, `tool-call`, `tool-result`) → `finish`.

## Generation Logs

Each generation persists a `GenerationLog` to `data/stories/<storyId>/generation-logs/`.

### Standard Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique log ID (e.g. `gen-m2abc`) |
| `createdAt` | `string` | ISO timestamp |
| `input` | `string` | Author's input text |
| `messages` | `Array<{role, content}>` | The compiled context messages sent to the writer |
| `toolCalls` | `ToolCallLog[]` | Tool invocations during generation |
| `generatedText` | `string` | Final output text |
| `fragmentId` | `string \| null` | Saved fragment ID |
| `model` | `string` | Resolved model ID |
| `durationMs` | `number` | Total generation time |
| `stepCount` | `number` | Writer agent step count |
| `finishReason` | `string` | Why generation stopped |
| `stepsExceeded` | `boolean` | Whether step limit was hit |
| `totalUsage` | `TokenUsage?` | Input/output token counts |
| `reasoning` | `string?` | Writer reasoning text |

### Prewriter-Specific Fields

These fields are only present when the prewriter was used:

| Field | Type | Description |
|---|---|---|
| `prewriterBrief` | `string` | The writing brief produced by the prewriter |
| `prewriterReasoning` | `string?` | Prewriter reasoning text |
| `prewriterMessages` | `Array<{role, content}>` | Prewriter's compiled context |
| `prewriterDurationMs` | `number` | Prewriter execution time |
| `prewriterModel` | `string` | Prewriter's resolved model ID |
| `prewriterUsage` | `TokenUsage?` | Prewriter token counts |

## Generation Modes

The `mode` parameter controls how prose is created and saved:

### Generate (default)

Continue the story. Creates a new prose fragment and appends it to the prose chain as a new section.

### Regenerate

Create an alternative version of an existing passage. Requires `fragmentId`. The existing fragment is excluded from context (so the model doesn't see what it's replacing). The result is saved as a new fragment and added as a **variation** to the same prose chain section.

### Refine

Edit an existing passage based on instructions. Requires `fragmentId`. The existing content is included in the prompt with the refinement request. Like regenerate, the result is saved as a variation.

For regenerate and refine, the context builder receives `excludeFragmentId`, `proseBeforeFragmentId`, and `summaryBeforeFragmentId` to ensure the model sees context as it was *before* the target fragment.

## File Reference

| File | Purpose |
|---|---|
| `src/server/llm/prewriter.ts` | `runPrewriter()`, `createPrewriterBlocks()`, `createWriterBriefBlocks()` |
| `src/server/llm/agents.ts` | Generation agent registration (writer + prewriter blocks, instruction defaults) |
| `src/server/llm/instruction-texts.ts` | Prompt text constants for generation instructions |
| `src/server/routes/generation.ts` | `POST /stories/:storyId/generate` endpoint |
| `src/server/llm/context-builder.ts` | `buildContextState()`, `createDefaultBlocks()`, `compileBlocks()`, `addCacheBreakpoints()` |
| `src/server/llm/writer-agent.ts` | `createWriterAgent()` — `ToolLoopAgent` wrapper |
| `src/server/llm/generation-logs.ts` | `GenerationLog` interface, `saveGenerationLog()`, `listGenerationLogs()` |
