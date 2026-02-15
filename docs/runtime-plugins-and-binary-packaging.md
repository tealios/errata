# Runtime Plugins + Bun Binary Packaging

This document explains how plugin loading works when packaging Errata into a Bun standalone executable, and how to use runtime (external) plugins safely.

## Goals

- Keep built-in plugins bundled into the app/binary.
- Allow loading additional plugins from disk at runtime (server-side).
- Keep plugin behavior predictable in both dev and compiled modes.

## Current Plugin Loading Model

Errata now supports two plugin sources:

1. **Static bundled plugins** (always available)
   - Loaded via `import.meta.glob('../../plugins/*/entry.server.ts', { eager: true })`.
   - These are compiled into the app (and into the standalone binary).

2. **External runtime plugins** (optional)
   - Loaded from disk at startup when `PLUGIN_DIR` is set.
   - Loaded server-side only.

Code references:

- `src/server/init.ts`
- `src/server/plugins/loader.ts`

## Runtime Plugin Directory

Set `PLUGIN_DIR` to a directory that contains one folder per plugin.

Each plugin folder may provide one of these server entry files (first match wins):

1. `entry.server.ts`
2. `entry.server.js`
3. `plugin.ts`
4. `plugin.js`

The module must export a valid `WritingPlugin` as `default` (or `plugin`).

Example layout:

```text
external-plugins/
  my-plugin/
    entry.server.ts
  dice-tools/
    plugin.js
```

## Duplicate Plugin Names and Override Behavior

Plugin names are unique by `plugin.manifest.name`.

- By default, if an external plugin has the same name as a bundled plugin, it is skipped.
- To allow external replacement, set:

```text
PLUGIN_EXTERNAL_OVERRIDE=1
```

When enabled, external plugin with duplicate name unregisters the current one and replaces it.

## Logging Behavior

Startup logs now include plugin loading results:

- external directory load success/failure
- count loaded/skipped from external source
- final list of registered plugin names

This helps verify what actually got mounted in production.

## Important Limitation: UI Panels for External Plugins

External runtime plugins are currently **server-only**.

Why:

- Client panels are discovered at build time via `import.meta.glob('../../plugins/*/entry.client.ts', { eager: true })`.
- That means only plugins present at build time can contribute sidebar panels in the frontend bundle.

What still works for external runtime plugins:

- server routes
- server tools
- server hooks
- server fragment types

What does not automatically work:

- dynamic client panel mounting for plugins added after build

## Standalone Binary Workflow

For Bun executable packaging, runtime plugin support works like this:

- Bundled plugins are inside the binary.
- External plugins are loaded from `PLUGIN_DIR` at runtime from disk.

Run example (Windows):

```bat
set PLUGIN_DIR=C:\errata\plugins
set PLUGIN_EXTERNAL_OVERRIDE=1
errata.exe
```

Run example (Linux/macOS):

```bash
PLUGIN_DIR=/opt/errata/plugins PLUGIN_EXTERNAL_OVERRIDE=1 ./errata
```

## Packaging Notes

- Keep `DEEPSEEK_API_KEY` and other secrets in environment variables.
- Keep story data external via `DATA_DIR`.
- Use external plugins only from trusted sources (runtime code execution risk).

## Suggested Build Command

Use Bun compile mode for a deployable executable:

```bash
bun build --compile --minify --bytecode src/standalone/server.ts --outfile dist/errata
```

If your entrypoint differs, replace `src/standalone/server.ts` with your server entry.

## Security Considerations

External plugins are arbitrary code loaded at runtime.

Recommendations:

- Use a dedicated plugin directory with restricted write access.
- Review plugin code before deployment.
- Run Errata with least-privilege OS/service credentials.
- Treat `PLUGIN_EXTERNAL_OVERRIDE=1` as a controlled deployment setting.
