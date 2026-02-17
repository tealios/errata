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
   - Server features load at runtime.
   - Optional UI can be served by Errata via `plugin.json` + iframe panel.

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
    plugin.json
    ui/
      index.html
      panel.css
      panel.js
  dice-tools/
    plugin.js
```

## Runtime UI Panels via plugin.json (Iframe)

External plugins can define a panel UI without being in the frontend build.

Create `plugin.json` in the plugin root:

```json
{
  "name": "my-plugin",
  "panel": {
    "title": "My Plugin",
    "entry": "ui/index.html",
    "icon": { "type": "lucide", "name": "Sparkles" }
  }
}
```

Rules:

- `name` (if provided) must match `manifest.name` from `entry.server.*`.
- `panel.title` overrides the sidebar panel title.
- `panel.entry` points to the HTML entry file relative to plugin root.
- `panel.icon` can set sidebar icon:
  - lucide: `{ "type": "lucide", "name": "Keyboard" }`
  - svg: `{ "type": "svg", "src": "/api/plugins/my-plugin/ui/icon.svg" }`

Errata serves panel assets at:

- `GET /api/plugins/:pluginName/ui/` (entry HTML)
- `GET /api/plugins/:pluginName/ui/*` (relative assets)

The app renders these panels in an iframe for enabled plugins.

Code references:

- `src/server/plugins/loader.ts`
- `src/server/plugins/runtime-ui.ts`
- `src/server/api.ts`
- `src/components/sidebar/DetailPanel.tsx`

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

## UI Modes and Limits

External runtime plugin UI currently supports **iframe mode** via `plugin.json`.

- Good for: standalone HTML/CSS/JS plugin UIs loaded at runtime.
- Not supported (for external plugins): runtime React component mounting into host bundle.

Bundled plugins can still use `entry.client.ts` React panels discovered at build time.

## Standalone Binary Workflow

Bundled plugins are inside the binary. External plugins are loaded from `PLUGIN_DIR` at runtime from disk.

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

Plugin panel URL when enabled: `http://localhost:3000/api/plugins/my-plugin/ui/`

## Build + Package Commands

Use the project scripts instead of calling `bun build --compile` directly:

```bash
bun run build:binary     # vite build + bun build --compile → dist/errata(.exe) + dist/public/
bun run package:binary   # zip binary + public/ → dist/errata-bundle.zip
bun run release:binary   # both steps
```

The binary wrapper (`scripts/binary-entry.mjs`) remaps virtual Bun paths so runtime asset reads resolve to `dist/public/`.

## CI: Automated Release Builds

The GitHub Actions workflow at `.github/workflows/release-binary.yml` builds binaries automatically on every release publish.

It builds on three platforms in parallel:

| Runner | Artifact |
|--------|----------|
| `windows-latest` | `errata-windows-x64.zip` |
| `ubuntu-latest` | `errata-linux-x64.zip` |
| `macos-latest` | `errata-macos-arm64.zip` |

Each zip contains the compiled binary + `public/` static assets. Archives are uploaded to the GitHub release as assets.

To trigger: create a release on GitHub (or `gh release create v1.x.x`).

## Packaging Notes

- Keep `DEEPSEEK_API_KEY` and other secrets in environment variables.
- Keep story data external via `DATA_DIR`.
- Use external plugins only from trusted sources (runtime code execution risk).
- External iframe panels are sandboxed (`allow-scripts allow-same-origin allow-forms`).

## Startup Directory Bootstrapping

On startup, Errata now creates missing base directories automatically:

- `DATA_DIR`
- `DATA_DIR/stories`
- `PLUGIN_DIR` (if set)

This removes the need to pre-create empty folders on fresh installs.

## Security Considerations

External plugins are arbitrary code loaded at runtime.

Recommendations:

- Use a dedicated plugin directory with restricted write access.
- Review plugin code before deployment.
- Run Errata with least-privilege OS/service credentials.
- Treat `PLUGIN_EXTERNAL_OVERRIDE=1` as a controlled deployment setting.
