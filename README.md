# Errata

An AI-assisted writing application built around a **fragment system** — where prose, characters, guidelines, and world knowledge are all composable fragments that form rich LLM context for story generation.

## What is Errata?

Errata treats creative writing as structured composition. Instead of a single document, your story is a collection of **fragments** — prose passages, character sheets, world-building knowledge, and writing guidelines — that are assembled into intelligent context for an LLM to generate continuations.

**Key ideas:**

- **Everything is a fragment.** Prose, characters, guidelines, knowledge entries — all share the same underlying data model with typed prefixes (`pr-`, `ch-`, `gl-`, `kn-`).
- **Context is composable.** Sticky fragments are always included in LLM context. Non-sticky fragments appear as shortlists the model can reference. You control what the AI "knows" at generation time.
- **Prose chain.** Generated prose entries form an ordered chain with variation support — regenerate or refine any passage, switch between alternatives, and remove entries.
- **Librarian agent.** A background process that analyzes new prose, maintains a rolling summary, tracks character mentions, flags contradictions, suggests new knowledge fragments, and builds a timeline.
- **Plugin system.** Extend Errata with custom fragment types, LLM tools, API routes, UI panels, and pipeline hooks.

## Features

- Streaming prose generation with multi-step tool use
- Multi-provider LLM support (any OpenAI-compatible endpoint)
- Onboarding wizard for quick story setup
- Story creation wizard (guidelines → characters → knowledge → prose)
- Fragment editor with tags, references, sticky toggle, and system/user placement
- Prose chain with inline editing, regeneration, refinement, and versioning
- Drag-and-drop fragment reordering with custom context ordering
- Background librarian agent for consistency tracking
- Archive system for soft-deleting fragments
- Generation debug panel for inspecting prompts, tool calls, and outputs
- Plugin system with example plugins (Names, Dice Roll)
- Filesystem-based storage — no database required

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Frontend | [TanStack Start](https://tanstack.com/start) (React 19) |
| Routing | [TanStack Router](https://tanstack.com/router) |
| Server State | [TanStack Query](https://tanstack.com/query) |
| Backend | [Elysia](https://elysiajs.com) (embedded in TanStack Start) |
| Validation | [Zod](https://zod.dev) v4 |
| LLM | [Vercel AI SDK](https://sdk.vercel.ai) v6 |
| Styling | [Tailwind CSS](https://tailwindcss.com) v4 + [shadcn/ui](https://ui.shadcn.com) |
| Testing | [Vitest](https://vitest.dev) + React Testing Library |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) 1.x or later

### Installation

```bash
git clone https://github.com/nokusukun/errata.git
cd errata
bun install
```

### Configuration

Create a `.env` file in the project root:

```env
# LLM provider (configured via the UI, but you can set a default here)
DEEPSEEK_API_KEY=your-api-key-here

# Data directory (default: ./data)
DATA_DIR=./data

# Server port (default: 3000)
PORT=3000
```

LLM providers are configured through the in-app settings panel — Errata supports any OpenAI-compatible API endpoint.

### Running

```bash
# Development server
bun run dev

# Production build
bun run build
bun run preview
```

Visit `http://localhost:3000` to open Errata.

On first launch, the onboarding wizard will guide you through configuring an LLM provider.

## Project Structure

```
errata/
├── src/
│   ├── routes/                    # TanStack Router pages
│   │   ├── index.tsx              # Home — story list
│   │   ├── story.$storyId.tsx     # Main story editor
│   │   ├── __root.tsx             # Root layout
│   │   └── api.$.ts               # Elysia catch-all API route
│   │
│   ├── server/                    # Backend (runs inside TanStack Start)
│   │   ├── api.ts                 # Elysia app + all API routes
│   │   ├── fragments/             # Fragment storage, schema, registry
│   │   ├── llm/                   # LLM client, context builder, tools
│   │   ├── librarian/             # Background analysis agent
│   │   ├── plugins/               # Plugin loader and hook system
│   │   └── config/                # Provider configuration
│   │
│   ├── components/                # React components
│   │   ├── prose/                 # Prose chain view, inline editing
│   │   ├── fragments/             # Fragment list, editor
│   │   ├── generation/            # Generation panel, debug view
│   │   ├── wizard/                # Story creation wizard
│   │   ├── onboarding/            # First-run onboarding
│   │   ├── settings/              # Provider manager, story settings
│   │   ├── sidebar/               # Navigation sidebar, panels
│   │   └── ui/                    # shadcn/ui primitives
│   │
│   └── lib/                       # Shared utilities, API client
│
├── plugins/                       # Plugin directory
│   ├── names/                     # Random name generator plugin
│   └── diceroll/                  # Dice roll plugin
│
├── tests/                         # Vitest test suite
│   ├── fragments/                 # Storage, schema, registry tests
│   ├── llm/                       # Context builder, tools, generation tests
│   ├── librarian/                 # Librarian agent tests
│   └── plugins/                   # Plugin integration tests
│
└── data/                          # Runtime data (gitignored)
    └── stories/<storyId>/
        ├── meta.json
        ├── fragments/             # Individual fragment JSON files
        ├── prose-chain.json
        ├── generation-logs/
        └── librarian/
```

## Architecture

Elysia runs embedded inside TanStack Start via a catch-all server route (`/api/$`). This means:

- Single deployment artifact — no separate API server
- Zero HTTP overhead for server-side calls
- End-to-end type safety via Eden Treaty

```
Browser ←→ TanStack Start (Vite)
                  │
             /api/* → Elysia (embedded)
                  │
             Filesystem Storage (data/)
                  │
             LLM Provider (streaming)
```

### Fragment System

Every piece of content is a **fragment** with a typed, human-readable ID:

| Type | Prefix | Purpose |
|---|---|---|
| Prose | `pr-` | Story passages in the prose chain |
| Character | `ch-` | Character sheets and descriptions |
| Guideline | `gl-` | Writing style and rules for the LLM |
| Knowledge | `kn-` | World-building facts and lore |

Fragments have **tags** for categorization, **refs** for cross-references, a **sticky** flag to force inclusion in LLM context, and **placement** control (system vs user message).

### Generation Pipeline

```
Author input
  → buildContext() — assemble fragments into messages
  → Plugin beforeContext hooks
  → Plugin beforeGeneration hooks
  → streamText() with fragment tools
  → Stream to client
  → Plugin afterGeneration hooks
  → Save prose fragment + enroll in chain
  → Plugin afterSave hooks
  → Trigger librarian analysis
```

### Plugin System

Plugins live in `plugins/<name>/plugin.ts` and implement the `WritingPlugin` interface:

```typescript
interface WritingPlugin {
  name: string
  version: string
  description: string
  fragmentTypes?: FragmentTypeDefinition[]
  tools?: Record<string, Tool>
  routes?: (app: Elysia) => Elysia
  hooks?: PipelineHooks
  panel?: { title: string; component: React.ComponentType }
}
```

Plugins can register custom fragment types, LLM tools, API routes, pipeline hooks (`beforeContext`, `beforeGeneration`, `afterGeneration`, `afterSave`), and UI panels.

## Development

### Commands

```bash
bun install                          # Install dependencies
bun run dev                          # Start dev server
bun run build                        # Production build
bun run test                         # Run all tests
bun run test:watch                   # Watch mode
bunx vitest run tests/fragments/     # Run specific test directory
```

### Testing

Tests mirror the `src/server/` structure. The test suite covers storage, API routes, LLM context building, tool definitions, generation pipeline, librarian agent, and plugin integration.

```bash
bun run test
```

### Adding UI Components

```bash
bunx shadcn@latest add <component>
```

Components are installed to `src/components/ui/`.

## License

MIT

---

Built by [nokusukun](https://github.com/nokusukun)
