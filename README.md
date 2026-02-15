# Errata

Errata is a writing app built around a fragment system: prose, characters, guidelines, and knowledge are all composable fragments used to generate story continuations.

## Highlights

- Fragment-first writing workflow with sticky/system placement controls
- Prose chain with variations (regenerate/refine/switch/remove)
- Streaming generation with tool calls + debug logs
- Librarian background agent (summary, contradictions, timeline)
- Extensible plugin system (server + runtime iframe panels)
- Filesystem storage (no database required)

## Stack

- Runtime: Bun
- Frontend: TanStack Start + React 19
- Backend: Elysia (embedded in Start)
- Validation: Zod v4
- Generation: AI SDK v6
- Styling: Tailwind v4 + shadcn/ui
- Tests: Vitest + RTL

## Quick Start

```bash
git clone https://github.com/nokusukun/errata.git
cd errata
bun install
bun run dev
```

Open `http://localhost:3000`.

### Optional `.env`

```env
DEEPSEEK_API_KEY=your-api-key
DATA_DIR=./data
PORT=3000
```

## Scripts

- `bun run dev` - start development server
- `bun run build` - production build
- `bun run preview` - preview production build
- `bun run test` - run test suite
- `bun run new:plugin <name>` - scaffold plugin from template

### Binary/Release

- `bun run build:binary` - build executable + required `dist/public`
- `bun run package:binary` - zip binary bundle (`dist/errata-bundle.zip`)
- `bun run release:binary` - build + package in one step

## Project Layout

```text
src/                    app code (routes, server, components, lib)
plugins/                built-in plugins + templates
packages/               local packages (includes plugin SDK)
tests/                  vitest suites
docs/                   documentation
```

## Plugin System (Moved to Docs)

Plugin documentation now lives in dedicated docs pages:

- `docs/README.md` - docs index
- `docs/third-party-plugins.md` - authoring external plugins
- `docs/runtime-plugins-and-binary-packaging.md` - runtime loading + binary deployment
- `plugins/templates/README.md` - complete plugin recipe templates

### SDK for Plugin Authors

Use the SDK package for plugin contracts/types:

- `@tealios/errata-plugin-sdk`

This is the supported import path for third-party plugin repos.

## Notes

- On startup, Errata creates missing base directories (`DATA_DIR`, `DATA_DIR/stories`, and `PLUGIN_DIR` if set).
- Runtime external plugin UI uses iframe mode (`plugin.json` + `ui/index.html`).

---

Built by [nokusukun](https://github.com/nokusukun)
