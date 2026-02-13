# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Errata is an AI-assisted writing app built around a **fragment system** — everything (prose, characters, guidelines, knowledge) is a fragment. Fragments compose into LLM context to generate story continuations. See `PLAN.md` for the full architecture and implementation phases.

## Commands

```bash
bun install                          # Install dependencies
bun run dev                          # Start dev server (TanStack Start + Elysia)
bun test                             # Run all tests
bun test --watch                     # Watch mode
bun test tests/fragments/            # Run tests in a specific directory
bun test --filter "storage"          # Filter tests by name
```

## Architecture

**Embedded Elysia in TanStack Start**: Elysia runs inside a TanStack Start catch-all server route (`src/routes/api.$.ts`). Eden Treaty provides end-to-end type safety — server-side calls bypass HTTP entirely, client-side calls use HTTP with full type inference. The isomorphic client lives at `src/server/treaty.ts`.

**Filesystem storage**: No database. All data is JSON files under `data/stories/<storyId>/`. Fragments are individual files (`pr-a1b2.json`), associations are in `associations.json`. Uses `Bun.file()` / `Bun.write()`.

**Fragment IDs**: Short, human-readable. Pattern: `{2-char-prefix}-{4-8 alphanumeric}`. Prefixes: `pr` (prose), `ch` (character), `gl` (guideline), `kn` (knowledge). Plugins register their own prefixes.

**LLM integration**: Vercel AI SDK v6 with `@ai-sdk/deepseek`. The context builder (`src/server/llm/context-builder.ts`) assembles messages from fragments — sticky fragments go in full, others appear as shortlists (id + description). The LLM gets tool calls (`fragmentGet`, `fragmentList`, etc.) to fetch additional context on demand.

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
- API routes: call Elysia via Eden Treaty, assert responses
- LLM/generation: mock Vercel AI SDK (`streamText`, `generateText`), verify message assembly and side effects
- Plugins: use a test plugin fixture, verify registration and hook execution
- Components: React Testing Library

## Key Conventions

- All validation uses **Zod** schemas (defined in `src/server/fragments/schema.ts`). Types are inferred with `z.infer<>`, never manually duplicated.
- Fragment descriptions are **max 50 characters** — they appear in LLM context shortlists.
- The fragment type registry (`src/server/fragments/registry.ts`) is the source of truth for all fragment types. Plugins extend it at startup.
- Eden Treaty isomorphic client (`src/server/treaty.ts`) uses `createIsomorphicFn()` — always use `getTreaty()` for API calls, never raw `fetch`.
- LLM tools for fragments are defined in `src/server/llm/tools.ts` using Vercel AI SDK's `tool()` helper with Zod parameter schemas.
- Environment variables: `DEEPSEEK_API_KEY`, `DATA_DIR` (default `./data`), `PORT` (default `3000`).

## Efficiency Tips

- Read `PLAN.md` for schemas, interfaces, and data flow before implementing — most types and signatures are already defined there.
- When adding a new fragment type (built-in or plugin), touch: schema.ts (Zod), registry.ts (type definition + prefix), fragment-ids.ts (prefix map), and context-builder.ts (context behavior).
- When adding a new LLM tool, add it in `tools.ts` and register it in the tool pool passed to `streamText()` in the generation route.
- The `data/` directory is gitignored. Tests should use `Bun.tmpdir()` or `mkdtemp`, never write to `data/`.
