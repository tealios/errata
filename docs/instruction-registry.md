# Instruction Registry

## Overview

The instruction registry provides centralized management of all LLM prompt instructions with support for model-specific overrides. Instead of hardcoding system prompts in agent modules, each instruction is registered under a dot-separated key and resolved at runtime — optionally selecting a model-specific variant when one is configured.

This allows users to customize any instruction (system prompts, persona templates, tool suffixes) per model family without modifying code, via JSON files on disk.

## API

The singleton `instructionRegistry` is exported from `src/server/instructions/index.ts`.

| Method | Signature | Description |
|---|---|---|
| `registerDefault` | `(key: string, text: string) => void` | Register the default text for an instruction key. Called at module init. |
| `resolve` | `(key: string, modelId?: string) => string` | Resolve an instruction: checks overrides first (if `modelId` provided), then returns default. Throws if key is unregistered. |
| `getDefault` | `(key: string) => string \| undefined` | Return the default text without checking overrides. |
| `listKeys` | `() => string[]` | List all registered instruction keys. |
| `loadOverridesSync` | `(dataDir: string) => void` | Load all `InstructionSet` JSON files from `data/instruction-sets/`. Called once on startup. |
| `clear` | `() => void` | Reset all defaults and overrides. Used in tests. |

## Registered Instruction Keys

All 19 keys grouped by module:

### Generation (5)

| Key | Registered in | Description |
|---|---|---|
| `generation.system` | `src/server/llm/agents.ts` | Main writer system prompt |
| `generation.tools-suffix` | `src/server/llm/agents.ts` | Appended after tool descriptions in writer context |
| `generation.writer-brief.system` | `src/server/llm/agents.ts` | Writer system prompt when receiving a prewriter brief |
| `generation.writer-brief.tools-suffix` | `src/server/llm/agents.ts` | Tool suffix for brief-mode writer |
| `generation.prewriter.system` | `src/server/llm/agents.ts` | Prewriter agent system prompt |

### Librarian (6)

| Key | Registered in | Description |
|---|---|---|
| `librarian.analyze.system` | `src/server/librarian/agents.ts` | Background analysis system prompt |
| `librarian.chat.system` | `src/server/librarian/agents.ts` | Interactive librarian chat system prompt |
| `librarian.refine.system` | `src/server/librarian/agents.ts` | Fragment refinement system prompt |
| `librarian.optimize-character.system` | `src/server/librarian/agents.ts` | Character optimization system prompt (depth methodology) |
| `librarian.prose-transform.system` | `src/server/librarian/agents.ts` | Prose selection transform system prompt |
| `librarian.summary-compaction` | `src/server/librarian/agents.ts` | Summary compaction prompt template |

### Character Chat (5)

| Key | Registered in | Description |
|---|---|---|
| `character-chat.system` | `src/server/character-chat/agents.ts` | Character chat system prompt (uses `{{characterName}}`) |
| `character-chat.instructions` | `src/server/character-chat/agents.ts` | Roleplay behavior instructions |
| `character-chat.persona.character` | `src/server/character-chat/agents.ts` | Named character persona (uses `{{personaName}}`, `{{personaDescription}}`) |
| `character-chat.persona.stranger` | `src/server/character-chat/agents.ts` | Anonymous stranger persona |
| `character-chat.persona.custom` | `src/server/character-chat/agents.ts` | Custom persona (uses `{{prompt}}`) |

### Directions (2)

| Key | Registered in | Description |
|---|---|---|
| `directions.system` | `src/server/directions/agents.ts` | Direction suggestion system prompt |
| `directions.suggest-template` | `src/server/directions/agents.ts` | Suggest prompt template |

### Chapters (1)

| Key | Registered in | Description |
|---|---|---|
| `chapters.summarize.system` | `src/server/chapters/agents.ts` | Chapter summarization system prompt |

## Model-Specific Overrides

Overrides are defined as `InstructionSet` JSON files stored at `data/instruction-sets/*.json`.

### InstructionSet Schema

```ts
{
  name: string         // Human-readable name (min 1 char)
  modelMatch: string   // Exact model ID string or /regex/flags pattern
  priority: number     // Lower = higher precedence (default: 100)
  instructions: {      // Map of instruction key → replacement text
    [key: string]: string
  }
}
```

### Matching Logic

The `modelMatch` field supports two formats:

- **Exact string**: `"deepseek-chat"` — matches only that exact model ID
- **Regex pattern**: `"/deepseek-.*/i"` — parsed as a regular expression with optional flags

### Priority System

When multiple override files match the same model ID, they are sorted by `priority` ascending — **lower numbers are checked first**. The first match for a given key wins.

Example: Two files both match `deepseek-chat` for key `generation.system`:
- `high-priority.json` with `priority: 10` — this one wins
- `low-priority.json` with `priority: 200` — only used for keys not in the first file

### Example Override File

```json
{
  "name": "DeepSeek Overrides",
  "modelMatch": "/deepseek-.*/i",
  "priority": 50,
  "instructions": {
    "generation.system": "You are a creative fiction writer. Write the next passage...",
    "librarian.analyze.system": "Analyze the prose passage for continuity signals..."
  }
}
```

Keys not present in the `instructions` map fall through to the registered default.

## Template Variables

Some instruction keys contain `{{placeholder}}` markers that are substituted at call sites — not by the registry itself. The registry stores the raw template text.

| Key | Variables | Substituted in |
|---|---|---|
| `character-chat.system` | `{{characterName}}` | `src/server/character-chat/chat.ts` |
| `character-chat.persona.character` | `{{personaName}}`, `{{personaDescription}}` | `src/server/character-chat/chat.ts` |
| `character-chat.persona.custom` | `{{prompt}}` | `src/server/character-chat/chat.ts` |
| `directions.suggest-template` | (varies by caller) | `src/server/directions/suggest.ts` |

## Integration

Instructions flow into agent contexts through `instructionRegistry.resolve(key, modelId)`:

1. Agent block definitions call `resolve()` in their `createDefaultBlocks()` function
2. The `modelId` comes from `AgentBlockContext.modelId` (set during model resolution)
3. If the resolved model has a matching override, the override text is used instead of the default
4. The instruction text becomes the content of a context block (typically the `instructions` block)

### Startup

Overrides are loaded on server startup via `loadOverridesSync(dataDir)` in `src/server/api.ts`. This reads all JSON files from `data/instruction-sets/`, validates them against `InstructionSetSchema`, and sorts by priority. Malformed files are skipped with a warning.

## File Reference

| File | Purpose |
|---|---|
| `src/server/instructions/registry.ts` | `InstructionRegistry` class and singleton |
| `src/server/instructions/schema.ts` | `InstructionSetSchema` (Zod v4) and `InstructionSet` type |
| `src/server/instructions/index.ts` | Re-exports |
| `tests/instructions/registry.test.ts` | Full test suite |
