# Errata - Extensible Writing App

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [Fragment System](#fragment-system)
- [Plugin System](#plugin-system)
- [LLM Integration](#llm-integration)
- [Background Librarian Agent](#background-librarian-agent)
- [Frontend](#frontend)
- [API Routes](#api-routes)
- [Implementation Phases](#implementation-phases)
- [Development Workflow](#development-workflow)

---

## Overview

Errata is an extensible, AI-assisted writing application built around a **fragment system** where everything is a fragment. Fragments represent prose, characters, guidelines, knowledge, and any user-defined type via plugins. The app sends structured context (composed of fragments) to an LLM to generate prose continuations directed by the author.

---

## Architecture

**Embedded architecture**: Elysia runs inside TanStack Start server routes via the `/api/$` catch-all route. This gives us:
- Zero HTTP overhead for SSR calls (Eden Treaty calls Elysia directly on the server)
- Single deployment artifact
- End-to-end type safety via Eden Treaty
- Shared types without a separate contracts package

```
Browser <--HTTP--> TanStack Start (Vinxi/Vite)
                        |
                   /api/* routes --> Elysia (embedded)
                        |
                   Filesystem Storage (/data)
```

---

## Tech Stack

| Layer         | Technology                    | Version (as of Feb 2026) |
|---------------|-------------------------------|--------------------------|
| Runtime       | Bun                           | 1.3.x                   |
| Frontend      | TanStack Start (React)        | RC / 1.x                |
| Routing       | TanStack Router               | latest                   |
| Server State  | TanStack Query (React Query)  | 5.x                      |
| Backend       | Elysia                        | 1.4.x                   |
| Type Safety   | Eden Treaty                   | latest                   |
| Validation    | Zod                           | 3.x                     |
| LLM SDK       | Vercel AI SDK (`ai`)          | 6.x                     |
| LLM Provider  | `@ai-sdk/deepseek`           | latest                   |
| Styling       | Tailwind CSS + shadcn/ui      | 4.x / latest             |
| Editor        | TipTap or Lexical (TBD)       | latest                   |
| Testing       | Vitest + React Testing Lib    | 3.x / latest             |

### Key Dependencies
```jsonc
{
  "dependencies": {
    // Runtime & Framework
    "@tanstack/react-start": "^1.x",
    "@tanstack/react-router": "^1.x",
    "@tanstack/react-query": "^5.x",
    "elysia": "^1.4.x",
    "@elysiajs/eden": "^1.x",
    "react": "^19.x",
    "react-dom": "^19.x",

    // Validation & Types
    "zod": "^3.x",

    // LLM
    "ai": "^6.x",
    "@ai-sdk/deepseek": "latest",

    // Styling & UI Components
    "tailwindcss": "^4.x",
    // shadcn/ui components installed via `bunx shadcn@latest add <component>`

    // Editor (evaluate during Phase 2)
    // "@tiptap/react": "^2.x"  OR  "lexical": "^0.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/react": "^19.x",
    "@testing-library/react": "^16.x",
    "@testing-library/jest-dom": "latest",
    "vite": "^6.x"
  }
}
```

---

## Project Structure

```
errata/
├── package.json
├── tsconfig.json
├── vite.config.ts                    # TanStack Start + Vite config
├── PLAN.md
│
├── src/
│   ├── router.tsx                    # TanStack Router config
│   ├── routeTree.gen.ts              # Generated route tree
│   │
│   ├── routes/
│   │   ├── __root.tsx                # Root layout (shell, sidebar, providers)
│   │   ├── index.tsx                 # Home / story list
│   │   ├── story.$storyId.tsx        # Main editor view for a story
│   │   ├── story.$storyId.wizard.tsx # Story creation wizard
│   │   └── api.$.ts                  # Elysia catch-all API route
│   │
│   ├── server/
│   │   ├── api.ts                    # Elysia app definition + all routes
│   │   ├── treaty.ts                 # Eden Treaty isomorphic client
│   │   │
│   │   ├── fragments/
│   │   │   ├── schema.ts             # Zod schemas for fragments
│   │   │   ├── storage.ts            # Filesystem read/write operations
│   │   │   ├── registry.ts           # Fragment type registry
│   │   │   └── routes.ts             # Fragment CRUD Elysia routes
│   │   │
│   │   ├── llm/
│   │   │   ├── client.ts             # Vercel AI SDK client setup (DeepSeek)
│   │   │   ├── context-builder.ts    # Builds LLM prompt from fragments
│   │   │   ├── tools.ts              # LLM tool definitions (fragment tools)
│   │   │   └── routes.ts             # Generation endpoints (streaming)
│   │   │
│   │   ├── librarian/
│   │   │   ├── agent.ts              # Background librarian agent logic
│   │   │   ├── tasks.ts              # Librarian task definitions
│   │   │   └── scheduler.ts          # Scheduling / trigger logic
│   │   │
│   │   └── plugins/
│   │       ├── loader.ts             # Plugin discovery & loading
│   │       ├── types.ts              # Plugin interface definitions
│   │       └── hooks.ts              # Pipeline hook system
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Shell.tsx             # App shell (header + sidebar + content)
│   │   │   └── Sidebar.tsx           # Fragment browser sidebar
│   │   ├── editor/
│   │   │   ├── Editor.tsx            # Main prose editor component
│   │   │   ├── EditorToolbar.tsx     # Toolbar (generate, settings)
│   │   │   └── StreamingOutput.tsx   # Streaming LLM output display
│   │   ├── fragments/
│   │   │   ├── FragmentList.tsx       # List view for any fragment type
│   │   │   ├── FragmentCard.tsx       # Card component for fragment
│   │   │   ├── FragmentEditor.tsx     # Edit modal/panel for a fragment
│   │   │   └── FragmentBadge.tsx      # Tag/type badge
│   │   └── wizard/
│   │       ├── WizardShell.tsx        # Multi-step wizard container
│   │       ├── StepGuidelines.tsx     # Guideline creation step
│   │       ├── StepCharacters.tsx     # Character creation step
│   │       ├── StepKnowledge.tsx      # Knowledge creation step
│   │       └── StepProse.tsx          # Starting prose step
│   │
│   ├── lib/
│   │   ├── fragment-ids.ts           # Short ID generation (pr-xxx, ch-xxx)
│   │   ├── constants.ts              # App constants
│   │   └── utils.ts                  # Shared utilities
│   │
│   └── styles/
│       └── globals.css               # Tailwind imports + custom styles
│
├── tests/
│   ├── setup.ts                      # Test setup (globals, mocks)
│   ├── fragments/
│   │   ├── storage.test.ts           # Filesystem storage tests
│   │   ├── registry.test.ts          # Fragment type registry tests
│   │   ├── routes.test.ts            # Fragment API route tests
│   │   └── ids.test.ts               # Fragment ID generation tests
│   ├── llm/
│   │   ├── context-builder.test.ts   # Context assembly tests
│   │   ├── tools.test.ts             # LLM tool definition tests
│   │   └── generation.test.ts        # Generation pipeline tests
│   ├── librarian/
│   │   └── agent.test.ts             # Librarian analysis tests
│   ├── plugins/
│   │   ├── loader.test.ts            # Plugin discovery tests
│   │   └── hooks.test.ts             # Pipeline hook tests
│   └── components/
│       ├── FragmentList.test.tsx      # Fragment list rendering tests
│       ├── Editor.test.tsx           # Editor component tests
│       └── Wizard.test.tsx           # Wizard flow tests
│
├── data/                             # Filesystem storage root (gitignored)
│   └── stories/
│       └── <storyId>/
│           ├── meta.json             # Story metadata
│           ├── fragments/
│           │   ├── pr-a1b2.json      # Prose fragment
│           │   ├── ch-x9y8.json      # Character fragment
│           │   ├── gl-m3n4.json      # Guideline fragment
│           │   └── kn-p5q6.json      # Knowledge fragment
│           └── associations.json     # Fragment associations & tags
│
└── plugins/                          # Plugin directory
    └── names/
        └── plugin.ts                 # Example "Names" plugin
```

---

## Data Model

### Core Schemas (Zod)

```typescript
import { z } from 'zod';

// --- Fragment ID patterns ---
// pr-[a-z0-9]{4}  (prose)
// ch-[a-z0-9]{4}  (character)
// gl-[a-z0-9]{4}  (guideline)
// kn-[a-z0-9]{4}  (knowledge)
// Plugin types define their own prefix

export const FragmentIdSchema = z.string().regex(/^[a-z]{2}-[a-z0-9]{4,8}$/);

export const FragmentTypeSchema = z.enum([
  'prose',
  'character',
  'guideline',
  'knowledge',
]);

export const FragmentSchema = z.object({
  id: FragmentIdSchema,
  type: FragmentTypeSchema,           // extensible via plugins
  name: z.string().max(100),
  description: z.string().max(50),    // Short description for context lists
  content: z.string(),                // Full content
  tags: z.array(z.string()).default([]),
  refs: z.array(FragmentIdSchema).default([]),  // References to other fragments
  sticky: z.boolean().default(false), // Always in LLM context?
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  order: z.number().int().default(0), // Ordering within type (for prose sequence)
  meta: z.record(z.unknown()).default({}), // Extensible metadata for plugins
});

export type Fragment = z.infer<typeof FragmentSchema>;

// --- Story ---
export const StoryMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  summary: z.string().default(''),     // Maintained by librarian
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  settings: z.object({
    outputFormat: z.enum(['plaintext', 'markdown']).default('markdown'),
    enabledPlugins: z.array(z.string()).default([]),
  }),
});

export type StoryMeta = z.infer<typeof StoryMetaSchema>;

// --- Associations ---
export const AssociationsSchema = z.object({
  // tag -> fragmentId[]
  tagIndex: z.record(z.array(FragmentIdSchema)).default({}),
  // fragmentId -> fragmentId[] (bidirectional refs tracked here)
  refIndex: z.record(z.array(FragmentIdSchema)).default({}),
});
```

### Fragment ID Generation

```typescript
// lib/fragment-ids.ts
const PREFIXES: Record<string, string> = {
  prose: 'pr',
  character: 'ch',
  guideline: 'gl',
  knowledge: 'kn',
};

export function generateFragmentId(type: string): string {
  const prefix = PREFIXES[type] ?? type.slice(0, 2);
  const suffix = Math.random().toString(36).slice(2, 6); // 4 chars
  return `${prefix}-${suffix}`;
}
```

---

## Fragment System

### Storage Layer (`server/fragments/storage.ts`)

All data lives on the filesystem under `data/stories/<storyId>/`.

```
Operation         | File path
------------------|------------------------------------------
Read fragment     | data/stories/{sid}/fragments/{fid}.json
Write fragment    | data/stories/{sid}/fragments/{fid}.json
Delete fragment   | rm data/stories/{sid}/fragments/{fid}.json
List fragments    | readdir data/stories/{sid}/fragments/ + filter by prefix
List stories      | readdir data/stories/
Associations      | data/stories/{sid}/associations.json
```

Uses `Bun.file()` and `Bun.write()` for performant filesystem access.

### Fragment Type Registry (`server/fragments/registry.ts`)

Maintains a map of registered fragment types (built-in + plugin-contributed). Each type entry includes:
- `type`: string identifier
- `prefix`: 2-char ID prefix
- `schema`: optional Zod schema extending base Fragment for type-specific `meta`
- `sticky`: default stickiness behavior
- `contextRenderer`: function that renders the fragment into LLM context format

```typescript
interface FragmentTypeDefinition {
  type: string;
  prefix: string;
  schema?: z.ZodType;
  stickyByDefault: boolean;
  contextRenderer: (fragment: Fragment) => string;
  shortlistFields?: (keyof Fragment)[];  // Fields to include in context shortlists
}
```

### Context Behavior

| Fragment Type | In Context?               | Shortlist?                        | Notes                                |
|---------------|---------------------------|-----------------------------------|--------------------------------------|
| Prose         | Last N fragments (full)   | Full list (id, type, description) | N configurable, rest via tool call   |
| Character     | Recently mentioned (full) | No auto-list                      | Rest via `fragmentList('character')` |
| Guideline     | Sticky ones (full)        | Full list (id, name, description) | Retrieve via `fragmentGet(id)`       |
| Knowledge     | Sticky ones (full)        | Full list (id, name, description) | Retrieve via `fragmentGet(id)`       |

---

## Fragment Tool Calls (LLM Tools)

These are tools provided to the LLM during generation so it can look up context on demand.

```typescript
// server/llm/tools.ts
import { tool } from 'ai';
import { z } from 'zod';

export function createFragmentTools(storyId: string) {
  return {
    fragmentGet: tool({
      description: 'Get the full content of a fragment by its ID',
      parameters: z.object({
        fragmentId: z.string().describe('The fragment ID (e.g. ch-a1b2)'),
      }),
      execute: async ({ fragmentId }) => {
        // Read from filesystem and return
      },
    }),

    fragmentSet: tool({
      description: 'Overwrite a fragment with entirely new content',
      parameters: z.object({
        fragmentId: z.string(),
        newContent: z.string(),
        newDescription: z.string().max(50),
      }),
      execute: async ({ fragmentId, newContent, newDescription }) => {
        // Overwrite fragment on disk
      },
    }),

    fragmentEdit: tool({
      description: 'Edit a fragment by replacing a specific text span (for large prose/knowledge)',
      parameters: z.object({
        fragmentId: z.string(),
        oldText: z.string(),
        newText: z.string(),
      }),
      execute: async ({ fragmentId, oldText, newText }) => {
        // String replace in content
      },
    }),

    fragmentDelete: tool({
      description: 'Delete a fragment',
      parameters: z.object({
        fragmentId: z.string(),
      }),
      execute: async ({ fragmentId }) => {
        // Remove file from disk, update associations
      },
    }),

    fragmentList: tool({
      description: 'List all fragments of a given type (returns id, name, description)',
      parameters: z.object({
        type: z.string().describe('Fragment type: prose, character, guideline, knowledge'),
      }),
      execute: async ({ type }) => {
        // Read dir, filter by prefix, return shortlist
      },
    }),

    fragmentTypesList: tool({
      description: 'List all available fragment types',
      parameters: z.object({}),
      execute: async () => {
        // Return from registry
      },
    }),
  };
}
```

---

## Plugin System

### Plugin Interface

```typescript
// server/plugins/types.ts
import { Elysia } from 'elysia';
import type { FragmentTypeDefinition } from '../fragments/registry';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
}

export interface WritingPlugin {
  manifest: PluginManifest;

  // Register custom fragment types
  fragmentTypes?: FragmentTypeDefinition[];

  // Register custom LLM tools
  tools?: (storyId: string) => Record<string, ReturnType<typeof import('ai').tool>>;

  // Register additional Elysia API routes under /api/plugins/<name>/*
  routes?: (app: Elysia) => Elysia;

  // Pipeline hooks
  hooks?: {
    // Before the LLM context is assembled
    beforeContext?: (ctx: ContextBuildState) => ContextBuildState | Promise<ContextBuildState>;
    // After context is assembled, before sending to LLM
    beforeGeneration?: (messages: Message[]) => Message[] | Promise<Message[]>;
    // After LLM responds, before saving
    afterGeneration?: (result: GenerationResult) => GenerationResult | Promise<GenerationResult>;
    // After the generated fragment is saved
    afterSave?: (fragment: Fragment) => void | Promise<void>;
  };
}
```

### Plugin Lifecycle

1. **Discovery**: On server start, scan `plugins/*/plugin.ts` for default exports implementing `WritingPlugin`.
2. **Registration**: For each plugin:
   - Register fragment types into the registry
   - Mount API routes under `/api/plugins/<name>/`
   - Register LLM tools into the tool pool
   - Attach pipeline hooks
3. **Activation**: Per-story, plugins are enabled/disabled via `story.settings.enabledPlugins`.
4. **Execution**: During generation, only hooks from enabled plugins run.

### Example Plugin: Names (`plugins/names/plugin.ts`)

```typescript
import type { WritingPlugin } from '../../src/server/plugins/types';
import { tool } from 'ai';
import { z } from 'zod';

const namesPlugin: WritingPlugin = {
  manifest: {
    name: 'names',
    version: '1.0.0',
    description: 'Generate character names based on themes and cultures',
  },

  tools: (storyId) => ({
    'plugin.names.generate': tool({
      description: 'Generate a character name based on a theme or culture',
      parameters: z.object({
        theme: z.string().describe('Theme or culture for the name'),
        gender: z.string().optional(),
      }),
      execute: async ({ theme, gender }) => {
        // Call LLM or use a name database
        return { name: '...' };
      },
    }),
  }),
};

export default namesPlugin;
```

---

## LLM Integration

### Client Setup (`server/llm/client.ts`)

```typescript
import { createDeepSeek } from '@ai-sdk/deepseek';

export const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? 'sk-2106322f663f4d68a89c1386cb8f0ba5',
  // baseURL defaults to https://api.deepseek.com
});

export const defaultModel = deepseek('deepseek-chat');
```

### Context Builder (`server/llm/context-builder.ts`)

Assembles the LLM prompt from fragments. The builder:

1. Loads the story metadata and summary
2. Loads the last N prose fragments (full content)
3. Loads sticky guideline/knowledge fragments (full content)
4. Builds a shortlist of all guideline/knowledge fragments (id, name, description)
5. Loads recently mentioned characters (detected by librarian)
6. Runs `beforeContext` plugin hooks
7. Assembles the final message array

```typescript
export async function buildContext(storyId: string, authorInput: string): Promise<Message[]> {
  const story = await loadStoryMeta(storyId);
  const enabledPlugins = getEnabledPlugins(story);

  let ctx: ContextBuildState = {
    story,
    proseFragments: await getRecentProse(storyId, { limit: 5 }),
    stickyGuidelines: await getStickyFragments(storyId, 'guideline'),
    stickyKnowledge: await getStickyFragments(storyId, 'knowledge'),
    guidelineShortlist: await getShortlist(storyId, 'guideline'),
    knowledgeShortlist: await getShortlist(storyId, 'knowledge'),
    recentCharacters: await getRecentlyMentionedCharacters(storyId),
    authorInput,
    pluginContextBlocks: [],
  };

  // Run plugin beforeContext hooks
  for (const plugin of enabledPlugins) {
    if (plugin.hooks?.beforeContext) {
      ctx = await plugin.hooks.beforeContext(ctx);
    }
  }

  return assembleMessages(ctx);
}
```

### Generation Flow

```
Author Input
    |
    v
buildContext(storyId, input)       -- assemble fragment context
    |
    v
beforeGeneration hooks             -- plugins modify messages
    |
    v
streamText({                       -- Vercel AI SDK
  model: defaultModel,
  messages,
  tools: {
    ...createFragmentTools(storyId),
    ...pluginTools,
  },
  maxSteps: 10,                    -- allow multi-step tool use
})
    |
    v
Stream response to client          -- SSE via toUIMessageStreamResponse()
    |
    v
afterGeneration hooks              -- plugins process result
    |
    v
Save as new prose fragment          -- fragmentSet
    |
    v
afterSave hooks                     -- plugins post-save logic
    |
    v
Trigger librarian (async)           -- background analysis
```

---

## Background Librarian Agent

The librarian is a background process that triggers after new prose is saved. It performs **full continuity management**.

### Responsibilities

1. **Summarize prose**: Update the story's rolling summary after new prose is generated.
2. **Detect character mentions**: Scan new prose for character names, update a `recentlyMentioned` index.
3. **Flag contradictions**: Compare new prose against existing knowledge/character fragments for inconsistencies.
4. **Suggest knowledge updates**: If new world-building details appear in prose, suggest new knowledge fragments.
5. **Maintain timeline**: Track temporal references and maintain a chronological event index.

### Implementation (`server/librarian/agent.ts`)

```typescript
export async function runLibrarian(storyId: string, newFragmentId: string): Promise<void> {
  const fragment = await loadFragment(storyId, newFragmentId);
  const story = await loadStoryMeta(storyId);
  const characters = await listFragments(storyId, 'character');

  // Use the LLM to analyze the new prose
  const { text } = await generateText({
    model: defaultModel,
    system: `You are a librarian agent for a story. Analyze the new prose and:
1. Provide a brief summary update to append to the story summary.
2. List any character names mentioned (match against known characters).
3. Flag any contradictions with established facts.
4. Suggest any new knowledge fragments if world-building details are introduced.
5. Note any temporal markers for the timeline.
Return your analysis as JSON.`,
    prompt: `Story summary so far: ${story.summary}\n\nKnown characters: ${characters.map(c => c.name).join(', ')}\n\nNew prose:\n${fragment.content}`,
  });

  // Parse and apply updates
  const analysis = JSON.parse(text);
  await applySummaryUpdate(storyId, analysis.summaryUpdate);
  await updateCharacterMentions(storyId, analysis.mentionedCharacters);
  // ... etc
}
```

### Scheduling

- Triggered asynchronously after each prose save (fire-and-forget via `afterSave` in the generation pipeline).
- Debounced: if multiple prose fragments are saved in quick succession, batch the librarian run.
- Results stored in `data/stories/<storyId>/librarian/` as JSON files.

---

## Frontend

### Pages

| Route                          | Component                 | Description                                          |
|--------------------------------|---------------------------|------------------------------------------------------|
| `/`                            | `index.tsx`               | Story list - shows all stories, create new           |
| `/story/:storyId`             | `story.$storyId.tsx`      | Main editor view with sidebar                        |
| `/story/:storyId/wizard`      | `story.$storyId.wizard.tsx` | Creation wizard for new stories                   |

### Main Editor Layout (`/story/:storyId`)

```
+-------+----------------------------------+
| Side  |         Editor Area              |
| bar   |                                  |
|       |  [Previous prose - read only]    |
| Prose |  [Previous prose - read only]    |
| Chars |  ...                             |
| Guide |  [Current prose - editable]      |
| Know  |                                  |
| Plugs |  --------------------------------|
|       |  [Author input box]              |
|       |  [Generate button]               |
|       |                                  |
|       |  [Streaming output area]         |
+-------+----------------------------------+
```

**Sidebar**: Collapsible panel with tabs for each fragment type. Each tab shows a list of fragments (name + description). Clicking a fragment opens it in an editor panel/modal. Fragments can be created, edited, deleted, tagged, and linked.

**Editor area**: Scrollable view of the prose chain. The latest prose block is editable. Below it, an input area for author direction and a generate button. When generating, the streaming output appears below in real-time.

### Creation Wizard (`/story/:storyId/wizard`)

Multi-step wizard flow:

1. **Story Setup** - Name, description, output format preference
2. **Guidelines** - Create initial guidelines (tone, style, genre, rules)
3. **Characters** - Define main characters
4. **Knowledge** - World-building, setting details
5. **Starting Prose** - Write or generate the opening prose

Each step creates the corresponding fragments. The wizard can be re-entered later to add more.

### Key Frontend Patterns

- **React Query** for all server state (fragments, story meta, lists)
- **Optimistic updates** for fragment edits
- **SSE streaming** for LLM generation via Vercel AI SDK's `useChat` or `useCompletion`
- **Eden Treaty** client for type-safe API calls (via `getTreaty()` isomorphic helper)

---

## API Routes

All API routes are defined in Elysia and mounted at `/api/*`.

### Fragment Routes (`/api/fragments`)

| Method   | Path                              | Description                           |
|----------|-----------------------------------|---------------------------------------|
| GET      | `/api/stories`                    | List all stories                      |
| POST     | `/api/stories`                    | Create a new story                    |
| GET      | `/api/stories/:storyId`           | Get story metadata                    |
| PUT      | `/api/stories/:storyId`           | Update story metadata                 |
| DELETE   | `/api/stories/:storyId`           | Delete a story                        |
| GET      | `/api/stories/:sid/fragments`     | List fragments (query: `?type=prose`) |
| GET      | `/api/stories/:sid/fragments/:fid`| Get a single fragment                 |
| POST     | `/api/stories/:sid/fragments`     | Create a fragment                     |
| PUT      | `/api/stories/:sid/fragments/:fid`| Update a fragment (full overwrite)    |
| PATCH    | `/api/stories/:sid/fragments/:fid`| Edit a fragment (partial text replace)|
| DELETE   | `/api/stories/:sid/fragments/:fid`| Delete a fragment                     |
| GET      | `/api/stories/:sid/fragment-types`| List available fragment types         |

### LLM Routes (`/api/llm`)

| Method | Path                               | Description                                |
|--------|------------------------------------|--------------------------------------------|
| POST   | `/api/stories/:sid/generate`       | Generate prose (streaming SSE response)     |
| GET    | `/api/stories/:sid/librarian/status` | Librarian status for the story            |
| GET    | `/api/stories/:sid/generation-logs` | List recent generation debug logs          |
| GET    | `/api/stories/:sid/generation-logs/:logId` | Get a specific generation debug log  |

### Plugin Routes

Plugins mount under `/api/plugins/<plugin-name>/*`.

---

## Implementation Phases

### Phase 1: Foundation
> Goal: Working fragment CRUD with filesystem storage and basic UI shell
> Approach: **Tests first** — write tests before implementation for each item.

- [ ] Initialize project: `bun create @tanstack/start@latest`, init git repo
- [ ] Configure test runner (`bun test`), test setup file, temp directory helpers
- [ ] Configure Elysia embedded in TanStack Start (`src/routes/api.$.ts`)
- [ ] Set up Eden Treaty isomorphic client
- [ ] **Test** → Implement Zod schemas for Fragment and StoryMeta (validate correct/invalid inputs)
- [ ] **Test** → Implement fragment ID generation (correct prefixes, uniqueness, format)
- [ ] **Test** → Implement filesystem storage layer (CRUD operations on temp dirs)
- [ ] **Test** → Implement fragment type registry with built-in types
- [ ] **Test** → Implement associations: tag index and ref index
- [ ] **Test** → Build all fragment CRUD Elysia routes (use Eden Treaty in tests)
- [ ] **Test** → Build story CRUD routes
- [ ] Basic frontend shell: sidebar + content area
- [ ] Story list page
- [ ] Fragment list and detail views in sidebar
- [ ] Fragment create/edit/delete UI

### Phase 2: LLM Integration
> Goal: Generate prose from author input using fragment context
> Approach: **Tests first** — mock LLM responses for deterministic tests.

- [x] Set up Vercel AI SDK with DeepSeek provider
- [x] **Test** → Implement context builder (verify correct message assembly from fixtures)
- [x] **Test** → Implement LLM tool definitions (verify schema, mock execute functions)
- [x] **Test** → Build generation endpoint (mock AI SDK, verify streaming contract)
- [x] **Test** → Save generated prose as new fragment (verify storage side effects)
- [x] Author input UI + generate button
- [x] Streaming output display in editor
- [x] Wire up the full generation pipeline (context -> LLM -> stream -> save)
- [x] **Integration test**: end-to-end generation with mocked LLM

### Phase 3: Editor & Polish
> Goal: Proper text editor experience and refined UX

- [ ] Evaluate and integrate rich text editor (TipTap or Lexical)
- [x] **Test** → Prose chain view (scrollable history of prose fragments)
- [x] Editable current prose block (inline editing of last prose block)
- [x] **Test** → Creation wizard (multi-step: Guidelines → Characters → Knowledge → Prose)
- [x] **Test** → Fragment tagging UI (verify tag operations)
- [x] **Test** → Fragment association/linking UI (verify ref operations)
- [x] Sidebar improvements: search, filter by tag, sort
- [x] **Test** → Generation debug view (show full prompt + tool calls for each generation)

#### Generation Debug View

A toggleable debug panel that shows exactly what was sent to the LLM and what tool calls it made during prose generation. Essential for understanding and tuning the context assembly.

**Backend changes:**
- New endpoint: `GET /api/stories/:storyId/generation-logs/:logId` — fetch a stored generation log
- New endpoint: `GET /api/stories/:storyId/generation-logs` — list recent generation logs
- On each generation, persist a log entry to `data/stories/<storyId>/generation-logs/<timestamp>.json` containing:
  ```json
  {
    "id": "<timestamp>",
    "createdAt": "...",
    "input": "author's input text",
    "messages": [
      { "role": "system", "content": "..." },
      { "role": "user", "content": "..." }
    ],
    "toolCalls": [
      {
        "toolName": "fragmentGet",
        "args": { "fragmentId": "ch-a1b2" },
        "result": { "id": "ch-a1b2", "name": "Alice", "..." : "..." }
      }
    ],
    "generatedText": "The resulting prose...",
    "fragmentId": "pr-xxxx or null",
    "model": "deepseek-chat",
    "durationMs": 1234
  }
  ```
- Capture tool calls from AI SDK's `streamText()` result via `result.toolCalls` / `result.steps` (accumulate during streaming)

**Frontend:**
- `src/components/generation/DebugPanel.tsx` — collapsible panel showing:
  - **Prompt tab**: full system message and user message, syntax-highlighted or in a `<pre>` block with sections clearly labeled (story meta, sticky fragments, shortlists, prose chain, tool hints)
  - **Tool calls tab**: chronological list of tool invocations with expandable args/results
  - **Stats**: model name, total tokens (if available), duration, fragment ID of saved result
- Toggle button in `GenerationPanel` header: "Debug" that opens/closes the debug view
- Also accessible from prose blocks that have `meta.generatedFrom` — clicking the "AI" badge opens the debug log for that generation
- Each generation log is linked to the resulting prose fragment via `fragmentId`

### Phase 4: Plugin System
> Goal: Extensible plugin architecture
> Approach: **Tests first** — test plugin loading, registration, and hook execution.

- [ ] Define WritingPlugin interface
- [ ] **Test** → Plugin discovery and loading from `plugins/*/plugin.ts`
- [ ] **Test** → Plugin fragment type registration (verify registry updates)
- [ ] **Test** → Plugin tool registration (verify tools appear in tool pool)
- [ ] **Test** → Plugin route mounting (verify routes respond)
- [ ] **Test** → Pipeline hooks execution order and data flow
- [ ] **Test** → Per-story plugin enable/disable
- [ ] Build example plugin: `names`
- [ ] Plugin management UI in sidebar

### Phase 5: Background Librarian
> Goal: Automated continuity management
> Approach: **Tests first** — use fixture prose and mock LLM for deterministic analysis.

- [ ] **Test** → Librarian agent core logic (given fixture prose, expect structured analysis)
- [ ] **Test** → Summary maintenance (verify summary updates append correctly)
- [ ] **Test** → Character mention detection (given known characters + prose, expect matches)
- [ ] **Test** → Contradiction detection (given conflicting facts, expect flags)
- [ ] **Test** → Knowledge fragment suggestions (given new world details, expect suggestions)
- [ ] **Test** → Timeline tracking (given temporal markers, expect ordered events)
- [ ] **Test** → Scheduling: trigger after prose save, debounce (verify timing)
- [ ] Librarian status UI (show recent analyses, suggestions)

### Phase 6: Hardening
> Goal: Production readiness

- [ ] Error handling across all routes (test error responses)
- [ ] Input validation on all endpoints (test boundary cases)
- [ ] Loading states and error states in UI
- [ ] Responsive design
- [ ] Keyboard shortcuts (generate, save, navigate fragments)
- [ ] Environment variable configuration (API keys, data dir, etc.)
- [ ] Performance: lazy loading fragments, pagination for large story lists
- [ ] CI: run full test suite on commit

---

## Development Workflow

### Tests-First Approach

Every feature follows this cycle:

1. **Write the test** — Define the expected behavior in a `*.test.ts` file.
2. **Run the test** — Confirm it fails (red).
3. **Implement** — Write the minimum code to make the test pass (green).
4. **Commit** — Commit the test + implementation together.
5. **Refactor** — Clean up if needed, re-run tests, commit again.

```
Write test (red) → Implement (green) → Commit → Refactor → Commit
```

### Testing Strategy

| Layer              | Tool                        | Approach                                                   |
|--------------------|-----------------------------|------------------------------------------------------------|
| Zod schemas        | `bun test`                  | Validate correct inputs pass, invalid inputs throw         |
| Storage layer      | `bun test` + temp dirs      | CRUD against real filesystem in temp directories           |
| API routes         | `bun test` + Eden Treaty    | Call Elysia routes via Treaty, assert responses            |
| Context builder    | `bun test` + fixtures       | Fixed fragment fixtures → assert correct message assembly  |
| LLM tools          | `bun test` + mocks          | Mock storage, verify tool execution side effects           |
| Generation         | `bun test` + mock AI SDK    | Mock `streamText`, verify streaming contract and save      |
| Plugins            | `bun test` + test plugin    | Load a test plugin, verify registration and hook execution |
| Librarian          | `bun test` + mock AI SDK    | Fixture prose → mock LLM analysis → verify updates        |
| React components   | `bun test` + RTL            | Render components, assert DOM output and interactions      |

### Commit Discipline

- **Commit after every meaningful edit**: each test + implementation pair, each refactor, each bug fix.
- Commit messages follow conventional commits: `test(fragments): add storage CRUD tests`, `feat(fragments): implement filesystem storage`.
- Keep commits atomic — one logical change per commit.
- Tests must pass before committing.

### Test File Conventions

- Test files live in `tests/` mirroring the `src/server/` structure.
- Component tests live in `tests/components/`.
- Test files are named `*.test.ts` (server) or `*.test.tsx` (components).
- Use `beforeEach` / `afterEach` to create and clean up temp directories.
- Fixture data lives in `tests/fixtures/` as JSON files.

### Running Tests

```bash
bun test                    # Run all tests
bun test --watch            # Watch mode
bun test tests/fragments/   # Run fragment tests only
bun test --filter "storage" # Filter by name
```

---

## Environment Variables

```env
DEEPSEEK_API_KEY=sk-2106322f663f4d68a89c1386cb8f0ba5
DATA_DIR=./data
PORT=3000
```

---

## Open Questions / Decisions for Later

1. **Rich text editor**: TipTap vs Lexical - evaluate during Phase 3 based on markdown support and extensibility.
2. ~~**Fragment versioning**~~: **DECIDED** — Keep a full history of generated fragments. History should be accessible, especially when viewing previously generated prose. Implementation: store version snapshots (e.g. `fragments/<id>/versions/<timestamp>.json`) alongside the current fragment. UI should allow browsing past versions when viewing generated prose.
3. **Multi-user**: Currently single-user. If needed later, add auth layer.
4. **Export**: Export story as single markdown/text file. Nice-to-have for Phase 6.
5. ~~**Librarian feedback loop**~~: **DECIDED** — Approval-based with auto-apply option. Librarian suggestions require author approval by default, but users can toggle an auto-apply mode for trusted operations. UI should show pending suggestions with accept/reject controls, plus a global toggle for auto-apply.
