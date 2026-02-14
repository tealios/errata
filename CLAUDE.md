# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Errata is an AI-assisted writing app built around a **fragment system** — everything (prose, characters, guidelines, knowledge) is a fragment. Fragments compose into LLM context to generate story continuations. See `PLAN.md` for the full architecture and implementation phases.

## Commands

```bash
bun install                          # Install dependencies
bun run dev                          # Start dev server (TanStack Start + Elysia)
bun run test                         # Run all tests (vitest)
bun run test:watch                   # Watch mode
bunx vitest run tests/fragments/     # Run tests in a specific directory
bunx vitest run --config vitest.config.ts -t "storage"  # Filter tests by name
bunx shadcn@latest add <component>   # Add a shadcn/ui component
```

## Architecture

**Embedded Elysia in TanStack Start**: Elysia runs inside a TanStack Start catch-all server route (`src/routes/api.$.ts`). Eden Treaty provides end-to-end type safety — server-side calls bypass HTTP entirely, client-side calls use HTTP with full type inference. The isomorphic client lives at `src/server/treaty.ts`.

**Filesystem storage**: No database. All data is JSON files under `data/stories/<storyId>/`. Fragments are individual files (`pr-a1b2.json`), associations are in `associations.json`. Uses Node.js `fs/promises` (for vitest compatibility).

**Fragment IDs**: Short, human-readable. Pattern: `{2-char-prefix}-{4-8 alphanumeric}`. Prefixes: `pr` (prose), `ch` (character), `gl` (guideline), `kn` (knowledge). Plugins register their own prefixes.

**LLM integration** (Phase 2 complete): Vercel AI SDK v6 (`ai@6.x`) with `@ai-sdk/deepseek`. Key files:
- `src/server/llm/client.ts` — DeepSeek provider + default model
- `src/server/llm/context-builder.ts` — Assembles system+user messages from fragments (sticky in full, non-sticky as shortlists)
- `src/server/llm/tools.ts` — 6 fragment tools: `fragmentGet`, `fragmentSet`, `fragmentEdit`, `fragmentDelete`, `fragmentList`, `fragmentTypesList`
- Generation endpoint: `POST /api/stories/:storyId/generate` with `{ input, saveResult }` body
- AI SDK v6 API: `tool()` uses `inputSchema` (not `parameters`), `streamText()` uses `stopWhen: stepCountIs(N)` (not `maxSteps`), streaming via `toTextStreamResponse()`

**Plugin system**: Plugins live in `plugins/<name>/plugin.ts` and implement `WritingPlugin`. They can register fragment types, LLM tools, API routes, and pipeline hooks (`beforeContext`, `beforeGeneration`, `afterGeneration`, `afterSave`). Plugins are enabled per-story.

**Generation pipeline**: Author input → `buildContext()` → plugin `beforeContext` hooks → plugin `beforeGeneration` hooks → `streamText()` with tools → stream to client → `afterGeneration` hooks → save fragment → `afterSave` hooks → trigger librarian.

**Librarian agent**: Background process triggered after prose saves. Maintains rolling summary, detects character mentions, flags contradictions, suggests knowledge fragments, tracks timeline. Results stored in `data/stories/<storyId>/librarian/`.

## Development Workflow

**Tests first, commit after every edit.** The cycle is:
1. Write a failing test in `tests/` (mirrors `src/server/` structure)
2. Implement the minimum code to pass
3. Commit the test + implementation together
4. Refactor if needed, commit again

Commit messages use conventional commits: `test(fragments): add storage CRUD tests`, `feat(llm): implement context builder`.

**Test patterns by layer:**
- Storage/schemas: real filesystem in temp directories, cleaned up in `afterEach`
- API routes: call Elysia directly via `app.fetch(new Request(...))`, assert responses
- LLM/generation: mock Vercel AI SDK (`streamText`, `generateText`), verify message assembly and side effects
- Plugins: use a test plugin fixture, verify registration and hook execution
- Components: React Testing Library

## Key Conventions

- All validation uses **Zod** schemas (defined in `src/server/fragments/schema.ts`). Types are inferred with `z.infer<>`, never manually duplicated.
- Fragment descriptions are **max 50 characters** — they appear in LLM context shortlists.
- The fragment type registry (`src/server/fragments/registry.ts`) is the source of truth for all fragment types. Plugins extend it at startup.
- Eden Treaty isomorphic client (`src/server/treaty.ts`) uses `createIsomorphicFn()` — always use `getTreaty()` for API calls, never raw `fetch`.
- LLM tools for fragments are defined in `src/server/llm/tools.ts` using Vercel AI SDK's `tool()` helper with Zod parameter schemas.
- **UI components** use **shadcn/ui** on top of Tailwind CSS. Add components via `bunx shadcn@latest add <name>`. Components land in `src/components/ui/`.
- Environment variables: `DEEPSEEK_API_KEY`, `DATA_DIR` (default `./data`), `PORT` (default `3000`).

## Efficiency Tips

- Read `PLAN.md` for schemas, interfaces, and data flow before implementing — most types and signatures are already defined there.
- When adding a new fragment type (built-in or plugin), touch: schema.ts (Zod), registry.ts (type definition + prefix), fragment-ids.ts (prefix map), and context-builder.ts (context behavior).
- When adding a new LLM tool, add it in `tools.ts` using AI SDK's `tool({ inputSchema: z.object(...), execute: async (...) => ... })` and include it in `createFragmentTools()`. The generation route in `api.ts` passes all tools to `streamText()`.
- To mock `streamText` in tests: `vi.mock('ai', ...)` and return an object with `text: Promise.resolve(...)`, `toTextStreamResponse: () => new Response(...)`. See `tests/llm/generation.test.ts` for the pattern.
- The `data/` directory is gitignored. Tests use `createTempDir()` from `tests/setup.ts`, never write to `data/`.
- Zod v4 is installed (`zod/v4` import path). Use `z.iso.datetime()` not `z.string().datetime()`.
- `createApp(dataDir)` in `src/server/api.ts` accepts a custom data directory for test isolation.
- Frontend uses `src/lib/api.ts` client for typed fetch calls (not Eden Treaty on client side currently).

## Important

Important: Make sure to look up the latest documentation via websearch (you don't know the latest version)
Important: Ask questions about uncertainities.

Use the following LLM endpoint (compatible with v1/chat/completions endpoint) for testing and development:
API: https://api.deepseek.com
APIKey: sk-2106322f663f4d68a89c1386cb8f0ba5


## Scratchpad

Use .agent/ as a scratchpad, update this file along with the short description of it's contents. 