# Errata - Extensible Writing App

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [Fragment System](#fragment-system)
- [Context Block System](#context-block-system)
- [LLM Integration](#llm-integration)
- [Agent Framework](#agent-framework)
- [Background Librarian](#background-librarian)
- [Plugin System](#plugin-system)
- [Frontend](#frontend)
- [API Routes](#api-routes)
- [Binary Distribution](#binary-distribution)
- [Development Workflow](#development-workflow)
- [Environment Variables](#environment-variables)

---

## Overview

Errata is a model-assisted writing application built around a **fragment system** — everything (prose, characters, guidelines, knowledge) is a fragment. Fragments compose into structured LLM context via a **block system** to generate story continuations directed by the author. Supports multiple LLM providers, a plugin architecture, and a background librarian agent for continuity management.

---

## Architecture

Elysia runs inside a TanStack Start catch-all server route (`src/routes/api.$.ts`). Single deployment artifact — compiles to a standalone Bun binary for distribution.

```
Browser <--HTTP--> TanStack Start (Vite/Nitro)
                        |
                   /api/* routes --> Elysia (embedded)
                        |
                   Filesystem Storage (data/)
```

---

## Tech Stack

| Layer         | Technology                    | Version           |
|---------------|-------------------------------|--------------------|
| Runtime       | Bun                           | 1.x               |
| Frontend      | TanStack Start (React)        | 1.132.x           |
| Routing       | TanStack Router               | 1.132.x           |
| Server State  | TanStack Query (React Query)  | 5.x               |
| Backend       | Elysia                        | 1.4.x             |
| Validation    | Zod                           | 4.x (`zod/v4`)    |
| LLM SDK       | Vercel AI SDK (`ai`)          | 6.x               |
| LLM Providers | `@ai-sdk/deepseek`, `@ai-sdk/openai-compatible` | latest |
| Styling       | Tailwind CSS 4.x + shadcn/ui | latest             |
| Build         | Vite 7.x + Nitro              | latest             |
| Testing       | Vitest + React Testing Lib    | 3.x / latest       |
| Compression   | fflate                        | 0.8.x             |

---

## Project Structure

```
errata/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── PLAN.md
├── CLAUDE.md
│
├── src/
│   ├── routes/
│   │   ├── __root.tsx                # Root layout
│   │   ├── index.tsx                 # Story list / home
│   │   ├── story.$storyId.tsx        # Main editor view
│   │   └── api.$.ts                  # Elysia catch-all API route
│   │
│   ├── server/
│   │   ├── api.ts                    # Elysia app + all route definitions
│   │   ├── init.ts                   # Startup bootstrapping
│   │   ├── treaty.ts                 # Eden Treaty isomorphic client
│   │   ├── story-archive.ts          # Story archive/export logic
│   │   │
│   │   ├── fragments/
│   │   │   ├── schema.ts             # Zod schemas (Fragment, StoryMeta, ProseChain)
│   │   │   ├── storage.ts            # Filesystem CRUD + versioned updates
│   │   │   ├── registry.ts           # Fragment type registry
│   │   │   └── prose-chain.ts        # Prose chain ordering with variations
│   │   │
│   │   ├── blocks/
│   │   │   ├── schema.ts             # Block config Zod schemas
│   │   │   ├── storage.ts            # Block config persistence
│   │   │   └── apply.ts              # Applies block config to default blocks
│   │   │
│   │   ├── config/
│   │   │   ├── schema.ts             # Provider config schemas + presets
│   │   │   └── storage.ts            # Global config persistence
│   │   │
│   │   ├── llm/
│   │   │   ├── client.ts             # Multi-provider model resolution
│   │   │   ├── context-builder.ts    # Block-based context assembly
│   │   │   ├── tools.ts              # Dynamic LLM tool generation
│   │   │   ├── writer-agent.ts       # Writer agent wrapper
│   │   │   └── generation-logs.ts    # Generation log storage
│   │   │
│   │   ├── agents/
│   │   │   ├── types.ts              # AgentDefinition, AgentInvocationContext
│   │   │   ├── registry.ts           # Global agent registry
│   │   │   ├── runner.ts             # Agent invocation with depth/timeout limits
│   │   │   ├── traces.ts             # Agent trace logging
│   │   │   ├── register-core.ts      # Core agent registration
│   │   │   └── index.ts              # Re-exports
│   │   │
│   │   ├── librarian/
│   │   │   ├── agent.ts              # Main librarian analysis logic
│   │   │   ├── agents.ts             # Librarian agent definitions
│   │   │   ├── llm-agents.ts         # LLM-based agent definitions
│   │   │   ├── chat.ts               # Chat with librarian
│   │   │   ├── refine.ts             # Fragment refinement via agent
│   │   │   ├── suggestions.ts        # Knowledge suggestion logic
│   │   │   ├── storage.ts            # Librarian state + analysis persistence
│   │   │   └── scheduler.ts          # Debounced trigger
│   │   │
│   │   ├── plugins/
│   │   │   ├── loader.ts             # Plugin discovery (bundled + external)
│   │   │   ├── types.ts              # WritingPlugin interface
│   │   │   ├── hooks.ts              # Pipeline hook system
│   │   │   └── tools.ts              # Plugin tool registration
│   │   │
│   │   └── logging/
│   │       ├── types.ts
│   │       ├── storage.ts
│   │       ├── logger.ts
│   │       └── index.ts
│   │
│   ├── components/
│   │   ├── prose/
│   │   │   ├── ProseChainView.tsx     # Scrollable prose chain
│   │   │   ├── ProseBlock.tsx         # Individual prose block
│   │   │   ├── ProseOutlinePanel.tsx  # Prose outline/navigation
│   │   │   ├── InlineGenerationInput.tsx # Author input
│   │   │   └── ChevronRail.tsx        # Navigation rail
│   │   ├── fragments/
│   │   │   ├── FragmentList.tsx       # Sidebar list with search/sort
│   │   │   ├── FragmentEditor.tsx     # Full editor (tags, refs, sticky, placement)
│   │   │   ├── FragmentExportPanel.tsx
│   │   │   ├── FragmentImportDialog.tsx
│   │   │   └── ContextOrderPanel.tsx  # Fragment ordering within blocks
│   │   ├── blocks/
│   │   │   ├── BlockEditorPanel.tsx   # Visual block editor
│   │   │   ├── BlockCreateDialog.tsx  # Custom block creation
│   │   │   ├── BlockPreviewDialog.tsx # Context preview
│   │   │   └── BlockContentView.tsx   # Block content display
│   │   ├── generation/
│   │   │   ├── GenerationPanel.tsx    # Streaming generation UI
│   │   │   └── DebugPanel.tsx         # Generation log inspector
│   │   ├── sidebar/
│   │   │   ├── StorySidebar.tsx       # Section navigation
│   │   │   ├── DetailPanel.tsx        # Detail rendering per section
│   │   │   ├── StoryInfoPanel.tsx
│   │   │   ├── SettingsPanel.tsx      # Story + LLM settings
│   │   │   ├── LibrarianPanel.tsx     # Librarian activity/chat
│   │   │   └── ArchivePanel.tsx       # Story archive
│   │   ├── wizard/
│   │   │   └── StoryWizard.tsx        # Multi-step creation wizard
│   │   ├── settings/
│   │   │   └── ProviderManager.tsx    # LLM provider CRUD
│   │   ├── onboarding/
│   │   │   └── OnboardingWizard.tsx   # First-run onboarding
│   │   ├── help/
│   │   │   ├── HelpPanel.tsx
│   │   │   └── help-content.tsx
│   │   └── ui/                        # shadcn/ui components
│   │
│   ├── lib/
│   │   ├── api/                       # Modular API client
│   │   │   ├── client.ts             # Typed fetch wrapper
│   │   │   ├── index.ts              # Re-exports
│   │   │   ├── types.ts              # Centralized API types
│   │   │   ├── fragments.ts
│   │   │   ├── stories.ts
│   │   │   ├── generation.ts
│   │   │   ├── blocks.ts
│   │   │   ├── librarian.ts
│   │   │   ├── config.ts
│   │   │   ├── settings.ts
│   │   │   ├── prose-chain.ts
│   │   │   └── plugins.ts
│   │   ├── fragment-ids.ts           # Pronounceable ID generation
│   │   ├── fragment-visuals.ts       # Fragment type visual shapes/colors
│   │   ├── fragment-clipboard.ts     # Copy/paste fragments
│   │   ├── dom-ids.ts               # data-component-id helpers
│   │   ├── plugin-panels.ts         # Client plugin registry, PanelEvent, notify functions
│   │   ├── plugin-panel-init.ts     # Auto-discovers bundled entry.client.ts files
│   │   ├── theme.tsx                # Theme provider (fonts, dark mode)
│   │   └── utils.ts
│   │
│   └── styles.css                    # Tailwind + custom styles
│
├── tests/
│   ├── setup.ts                      # Temp dir helpers, global setup
│   ├── fragments/                    # Schema, storage, ID tests
│   ├── llm/                          # Context builder, tools, generation tests
│   ├── librarian/                    # Agent, chat, refine, scheduler tests
│   ├── agents/                       # Agent runner tests
│   ├── blocks/                       # Block storage and apply tests
│   ├── api/                          # Route integration tests
│   ├── plugins/                      # Plugin loading and hook tests
│   └── fixtures/
│
├── plugins/                          # Bundled plugins
│   ├── color-picker/                # Fragment color tagging (uses panel hooks)
│   ├── diceroll/
│   ├── keybinds/
│   ├── names/
│   └── templates/                    # Plugin recipe templates
│
├── packages/
│   └── errata-plugin-sdk/            # Published as @tealios/errata-plugin-sdk
│
├── scripts/
│   ├── build-binary.mjs              # Compile to Bun standalone binary
│   ├── package-binary.mjs            # Zip binary + public assets
│   ├── new-plugin.mjs                # Plugin scaffolding
│   ├── binary-entry.mjs              # Binary runtime entry
│   └── proxy-with-qr.mjs            # Dev sharing with QR code
│
├── .github/workflows/
│   ├── release-binary.yml            # Build + upload binaries on release
│   └── publish-plugin-sdk.yml        # Publish SDK to npm on tag
│
└── data/                             # Filesystem storage root (gitignored)
    ├── config.json                   # Global provider config
    └── stories/
        └── <storyId>/
            ├── meta.json
            ├── prose-chain.json       # Ordered prose with variations
            ├── fragments/             # Individual fragment JSON files
            ├── associations.json
            ├── block-config.json      # Block editor config
            ├── generation-logs/
            └── librarian/
                ├── state.json
                ├── chat-history.json
                └── analyses/
```

---

## Data Model

### Fragment Schema

```typescript
import { z } from 'zod/v4'

export const FragmentIdSchema = z.string().regex(/^[a-z]{2,4}-[a-z0-9]{4,12}$/)

export const FragmentSchema = z.object({
  id: FragmentIdSchema,
  type: z.string().min(1),               // 'prose', 'character', 'guideline', 'knowledge', 'image', 'icon', or plugin types
  name: z.string().max(100),
  description: z.string().max(250),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  refs: z.array(FragmentIdSchema).default([]),
  sticky: z.boolean().default(false),     // Always in LLM context
  placement: z.enum(['system', 'user']).default('user'), // Which LLM message role
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  order: z.int().default(0),
  meta: z.record(z.string(), z.unknown()).default({}),
  archived: z.boolean().default(false),
  version: z.int().min(1).default(1),
  versions: z.array(z.object({           // Version history
    version: z.int().min(1),
    name: z.string().max(100),
    description: z.string().max(250),
    content: z.string(),
    createdAt: z.iso.datetime(),
    reason: z.string().optional(),
  })).default([]),
})
```

### Story Schema

```typescript
export const StoryMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  summary: z.string().default(''),            // Maintained by librarian
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  settings: z.object({
    outputFormat: z.enum(['plaintext', 'markdown']).default('markdown'),
    enabledPlugins: z.array(z.string()).default([]),
    summarizationThreshold: z.int().min(0).default(4),
    maxSteps: z.int().min(1).max(50).default(10),
    providerId: z.string().nullable().default(null),
    modelId: z.string().nullable().default(null),
    librarianProviderId: z.string().nullable().default(null),
    librarianModelId: z.string().nullable().default(null),
    autoApplyLibrarianSuggestions: z.boolean().default(false),
    contextOrderMode: z.enum(['simple', 'advanced']).default('simple'),
    fragmentOrder: z.array(z.string()).default([]),
    contextCompact: z.object({
      type: z.enum(['proseLimit', 'maxTokens', 'maxCharacters']),
      value: z.number().int().min(1),
    }).default({ type: 'proseLimit', value: 10 }),
  }),
})
```

### Prose Chain

Prose is ordered via a chain with variation support:

```typescript
export const ProseChainSchema = z.object({
  entries: z.array(z.object({
    proseFragments: z.array(FragmentIdSchema),  // All variations
    active: FragmentIdSchema,                    // Currently selected variation
  })),
})
```

### Provider Config

```typescript
export const ProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  preset: z.string().default('custom'),     // 'deepseek', 'openai', 'anthropic', 'openrouter', 'custom'
  baseURL: z.string().url(),
  apiKey: z.string().min(1),
  defaultModel: z.string().min(1),
  enabled: z.boolean().default(true),
  customHeaders: z.record(z.string(), z.string()).optional().default({}),
  createdAt: z.iso.datetime(),
})

export const GlobalConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).default([]),
  defaultProviderId: z.string().nullable().default(null),
})
```

### Fragment ID Prefixes

| Type       | Prefix |
|------------|--------|
| prose      | `pr`   |
| character  | `ch`   |
| guideline  | `gl`   |
| knowledge  | `kn`   |
| image      | `im`   |
| icon       | `ic`   |

IDs are pronounceable (e.g. `ch-bokura`, `pr-katemi`). Plugins register their own prefixes.

---

## Fragment System

### Storage

All data lives on the filesystem under `data/stories/<storyId>/`. Uses Node.js `fs/promises`.

Fragments support versioned updates — `updateFragmentVersioned()` snapshots the previous state into `versions[]` before applying changes.

### Type Registry

The registry (`src/server/fragments/registry.ts`) holds all fragment type definitions. Each type specifies:
- `type`, `prefix`, `stickyByDefault`
- `contextRenderer` — how to render the fragment into LLM context
- `llmTools` — whether to generate type-specific LLM tools (default: true)

Built-in types (prose, character, guideline, knowledge, image, icon) have `llmTools: false` because their content is included directly in context.

### Context Behavior

| Fragment Type | In Context?               | Shortlist?                        |
|---------------|---------------------------|-----------------------------------|
| Prose         | Last N (configurable)     | Full list (id, type, description) |
| Character     | Sticky ones (full)        | Full list (id, name, description) |
| Guideline     | Sticky ones (full)        | Full list (id, name, description) |
| Knowledge     | Sticky ones (full)        | Full list (id, name, description) |

---

## Context Block System

The context builder produces discrete **blocks** that can be manipulated before compilation into LLM messages. See `docs/context-blocks.md` for full documentation.

```
buildContextState() → beforeContext hooks → createDefaultBlocks() → applyBlockConfig() → beforeBlocks hooks → compileBlocks() → beforeGeneration hooks → streamText()
```

### Default Blocks

| Block ID | Role | Order | Content |
|---|---|---|---|
| `instructions` | system | 100 | Writing assistant instructions |
| `tools` | system | 200 | Available tools listing |
| `system-fragments` | system | 300 | System-placed sticky fragments |
| `story-info` | user | 100 | Story name + description |
| `summary` | user | 200 | Rolling story summary |
| `user-fragments` | user | 300 | User-placed sticky fragments |
| `shortlist-guidelines` | user | 400 | Non-sticky guideline shortlist |
| `shortlist-knowledge` | user | 410 | Non-sticky knowledge shortlist |
| `shortlist-characters` | user | 420 | Non-sticky character shortlist |
| `prose` | user | 500 | Recent prose chain |
| `author-input` | user | 600 | Author's direction |

Users can customize blocks via the Block Editor (requires Advanced prompt control mode in Settings). Custom blocks can be static text or JavaScript scripts with access to the full story context.

---

## LLM Integration

### Multi-Provider Support

Model resolution chain: story settings → global default → error if none configured.

Provider presets: DeepSeek, OpenAI, Anthropic, OpenRouter, Custom. Any OpenAI-compatible API works via `@ai-sdk/openai-compatible`. Stories can configure separate providers for generation and librarian.

### LLM Tools

Tools are dynamically generated per registered fragment type. Types with `llmTools: false` (all built-in types) are skipped since their content is already in context.

**Always available (generic):**
- `getFragment(id)` — get any fragment by ID
- `listFragments(type?)` — list fragments, optionally filtered
- `searchFragments(query, type?)` — full-text search across fragments
- `listFragmentTypes()` — list registered types

**Write tools (when not readOnly):**
- `createFragment(type, name, description, content)`
- `updateFragment(fragmentId, newContent, newDescription)`
- `editFragment(fragmentId, oldText, newText)`
- `deleteFragment(fragmentId)`
- `editProse(oldText, newText)` — search-and-replace across active prose chain
- `getStorySummary()` / `updateStorySummary(summary)`

**Per-type tools (for plugin types with `llmTools: true`):**
- `get{Type}(id)`, `list{Types}()`

### Generation Pipeline

```
Author Input
    |
buildContextState()                -- load fragments into typed state
    |
beforeContext hooks                -- plugins modify state
    |
createDefaultBlocks()              -- convert state to ContextBlock[]
    |
applyBlockConfig()                 -- user's block customizations
    |
beforeBlocks hooks                 -- plugins manipulate blocks
    |
compileBlocks()                    -- blocks → ContextMessage[]
    |
beforeGeneration hooks             -- plugins modify final messages
    |
streamText() with tools            -- Vercel AI SDK v6
    |
Stream to client (SSE)
    |
afterGeneration hooks
    |
Save prose fragment (versioned)
    |
afterSave hooks
    |
Trigger librarian (async)
```

---

## Agent Framework

A structured agent invocation system (`src/server/agents/`).

```typescript
interface AgentDefinition<TInput, TOutput> {
  name: string
  description: string
  inputSchema: ZodSchema
  outputSchema?: ZodSchema
  allowedCalls?: string[]
  run: (ctx: AgentInvocationContext, input: TInput) => Promise<TOutput>
}
```

The runner enforces depth limits, call count limits, and timeouts. Agents can invoke other agents via `ctx.invokeAgent()`. Traces are logged per-run.

Core agents: `librarian.analyze`, `librarian.refine`, `librarian.chat`.

---

## Background Librarian

Triggered after prose saves. Performs continuity management:

1. Updates rolling story summary
2. Detects character mentions
3. Flags contradictions
4. Suggests knowledge fragments
5. Tracks timeline events

Recent behavior updates:

- Reanalysis-safe summary application: when multiple analyses exist for the same prose fragment, summary rebuild/apply resolves to the latest analysis (`createdAt`, then `id` tie-break).
- `updateSummary` accepts structured signals (`events`, `stateChanges`, `openThreads`) and can derive canonical `summaryUpdate` text when freeform summary text is empty.
- Structured summary payload is persisted on each librarian analysis and surfaced in the sidebar Librarian panel.

Also supports interactive chat (ask questions about the story) and fragment refinement (improve a fragment via agent).

Storage at `data/stories/<storyId>/librarian/` — state, analyses, and chat history.

---

## Plugin System

Plugins implement `WritingPlugin` and can provide:
- Custom fragment types
- LLM tools
- API routes under `/api/plugins/<name>/`
- Server pipeline hooks (`beforeContext`, `beforeBlocks`, `beforeGeneration`, `afterGeneration`, `afterSave`)
- Client-side panel hooks (`onPanelOpen`, `onPanelClose`) — react to UI panel open/close events
- Sidebar UI panels (iframe-based for external plugins)

Two plugin sources:
1. **Bundled** — compiled into the app from `plugins/*/`
2. **External** — loaded at runtime from `PLUGIN_DIR`

Bundled plugins: `diceroll`, `keybinds`, `names`, `color-picker`.

### Client-Side Plugin Hooks

Panel open/close events are delivered to all plugins:

- **Bundled plugins**: via `onPanelOpen`/`onPanelClose` exports in `entry.client.ts`
- **External plugins**: via `postMessage` on the iframe window (`errata:panel-open`, `errata:panel-close`)

Bundled `entry.client.ts` exports:

```typescript
export const pluginName = 'my-plugin'
export const panel = MyPanelComponent                    // React component
export const activate = (ctx: PluginRuntimeContext) => {} // Plugin enabled
export const deactivate = (ctx: PluginRuntimeContext) => {} // Plugin disabled
export const onPanelOpen = (event: PanelEvent, ctx: PluginRuntimeContext) => {}
export const onPanelClose = (event: PanelEvent, ctx: PluginRuntimeContext) => {}
```

External iframe plugins listen via `postMessage`:

```js
window.addEventListener('message', (e) => {
  if (e.data.type === 'errata:panel-open')  { /* e.data.event, e.data.context */ }
  if (e.data.type === 'errata:panel-close') { /* e.data.event, e.data.context */ }
  if (e.data.type === 'errata:data-changed') { /* e.data.queryKeys */ }
})
```

`PanelEvent` is discriminated by `panel` field:

| `event.panel` | Extra fields | Fired when |
|---|---|---|
| `'fragment-editor'` | `fragment?: Fragment`, `mode: 'edit' \| 'create'` | Fragment editor opens/closes |
| `'debug'` | — | Debug panel opens/closes |
| `'providers'` | — | Provider manager opens/closes |
| `'export'` | — | Export panel opens/closes |
| `'wizard'` | — | Story wizard opens/closes |

### Query Cache Invalidation

Plugin runtimes (vanilla JS, no React context) can invalidate TanStack Query caches by dispatching a window event:

```typescript
window.dispatchEvent(new CustomEvent('errata:plugin:invalidate', {
  detail: { queryKeys: [['tags', storyId, fragmentId], ['fragment', storyId, fragmentId]] },
}))
```

The story route invalidates each key and broadcasts `errata:data-changed` to all plugin iframes.

Plugin SDK published as `@tealios/errata-plugin-sdk`. See `docs/third-party-plugins.md` for the development guide.

---

## Frontend

### Routes

| Route              | Component              | Description                    |
|--------------------|------------------------|--------------------------------|
| `/`                | `index.tsx`            | Story list, create/import      |
| `/story/:storyId`  | `story.$storyId.tsx`   | Main editor view with sidebar  |

The creation wizard (`StoryWizard.tsx`) is an overlay within the story route, not a separate route.

### Key Patterns

- **React Query** for server state with auto-refresh
- **Modular API client** (`src/lib/api/`) — typed fetch wrapper, no Eden Treaty on client side
- **SSE streaming** for generation via Vercel AI SDK
- **Theme system** with configurable prose fonts
- **Responsive layout** with mobile support

---

## API Routes

All routes mounted at `/api/*` via Elysia.

### Stories & Fragments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stories` | List stories |
| POST | `/api/stories` | Create story |
| GET | `/api/stories/:id` | Get story |
| PUT | `/api/stories/:id` | Update story |
| DELETE | `/api/stories/:id` | Delete story |
| GET | `/api/stories/:id/fragments` | List fragments (`?type=`) |
| GET | `/api/stories/:id/fragments/:fid` | Get fragment |
| POST | `/api/stories/:id/fragments` | Create fragment |
| PUT | `/api/stories/:id/fragments/:fid` | Update fragment |
| DELETE | `/api/stories/:id/fragments/:fid` | Delete fragment |
| GET | `/api/stories/:id/prose-chain` | Get prose chain |
| PUT | `/api/stories/:id/prose-chain` | Update prose chain |

### Generation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/stories/:id/generate` | Generate prose (streaming SSE) |
| GET | `/api/stories/:id/generation-logs` | List generation logs |
| GET | `/api/stories/:id/generation-logs/:logId` | Get full log |

### Blocks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stories/:id/blocks` | Get block config + builtin metadata |
| GET | `/api/stories/:id/blocks/preview` | Preview compiled context |
| POST | `/api/stories/:id/blocks/custom` | Create custom block |
| PUT | `/api/stories/:id/blocks/custom/:blockId` | Update custom block |
| DELETE | `/api/stories/:id/blocks/custom/:blockId` | Delete custom block |
| PATCH | `/api/stories/:id/blocks/config` | Update overrides/ordering |

### Librarian

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stories/:id/librarian/status` | Librarian state |
| GET | `/api/stories/:id/librarian/analyses` | List analyses |
| GET | `/api/stories/:id/librarian/analyses/:aid` | Get analysis |
| POST | `/api/stories/:id/librarian/chat` | Chat with librarian |
| POST | `/api/stories/:id/librarian/refine` | Refine a fragment |

### Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Get global config |
| POST | `/api/config/providers` | Add provider |
| PUT | `/api/config/providers/:id` | Update provider |
| DELETE | `/api/config/providers/:id` | Delete provider |

### Plugins

Plugins mount under `/api/plugins/<name>/*`. Plugin UI served from `/api/plugins/<name>/ui/*`.

---

## Binary Distribution

Compiles to a standalone Bun executable with static assets.

```bash
bun run build:binary     # Build binary (vite build + bun build --compile)
bun run package:binary   # Zip binary + public/ assets
bun run release:binary   # Both steps
```

GitHub Actions (`.github/workflows/release-binary.yml`) builds for Windows x64, Linux x64, and macOS ARM64 on every release tag.

---

## Development Workflow

Tests first, conventional commits.

```bash
bun install              # Install dependencies
bun run dev              # Dev server on port 7739
bun run test             # Run all tests (vitest)
bun run test:watch       # Watch mode
```

### Testing Strategy

| Layer | Approach |
|-------|----------|
| Schemas | Validate correct/invalid inputs |
| Storage | Real filesystem in temp directories |
| API routes | Call Elysia via `app.fetch(new Request(...))` |
| Context builder | Fixed fragment fixtures, assert message assembly |
| LLM/generation | Mock AI SDK (`streamText`, `generateText`) |
| Agents | Mock agent runner, verify invocation and traces |
| Blocks | Test config application and block manipulation |
| Plugins | Test plugin fixture, verify registration and hooks |
| Librarian | Fixture prose, mock LLM, verify analysis updates |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | Filesystem storage root |
| `PORT` | `7739` | Server port |
| `PLUGIN_DIR` | — | External plugin directory |
| `PLUGIN_EXTERNAL_OVERRIDE` | — | Allow external plugins to replace bundled ones |
