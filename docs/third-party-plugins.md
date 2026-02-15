# Third-Party Plugin Development

This guide is for building plugins that can be dropped into `PLUGIN_DIR` (or cloned into `plugins/`) and loaded by Errata.

Related docs:

- `docs/runtime-plugins-and-binary-packaging.md`
- `plugins/templates/README.md`

## Goals

- Clone plugin repo into plugin directory.
- Restart Errata.
- Plugin server features load automatically.
- Optional plugin UI appears in sidebar via iframe.

## Directory Layout

Each plugin lives in its own folder.

```text
my-plugin/
  entry.server.ts
  plugin.json
  ui/
    index.html
    panel.css
    panel.js
  README.md
```

## Required Server Entry

`entry.server.ts` (or `.js`) must export a valid `WritingPlugin`.

Install the SDK in your plugin project:

```bash
bun add @tealios/errata-plugin-sdk
```

```ts
import { definePlugin, type WritingPlugin } from '@tealios/errata-plugin-sdk'

const plugin: WritingPlugin = definePlugin({
  manifest: {
    name: 'my-plugin',
    version: '0.1.0',
    description: 'Example external plugin',
    panel: { title: 'My Plugin' },
  },
  // Optional server capabilities:
  // fragmentTypes, tools, routes, hooks
})

export default plugin
```

### SDK Layer (`@tealios/errata-plugin-sdk`)

The SDK is the stable contract for plugin authors:

- plugin types (`WritingPlugin`, `PluginManifest`, `Fragment`, `ContextBuildState`, etc.)
- helper API (`definePlugin` / `createPlugin`)

This avoids brittle imports like `../../src/server/...` for type definitions and gives better IDE support in standalone plugin repos.

Supported server entry filenames (first match wins):

1. `entry.server.ts`
2. `entry.server.js`
3. `plugin.ts`
4. `plugin.js`

## Optional UI via plugin.json

If you want a sidebar panel without rebuilding the frontend bundle, add `plugin.json`:

```json
{
  "name": "my-plugin",
  "panel": {
    "title": "My Plugin",
    "entry": "ui/index.html"
  }
}
```

Rules:

- `name` must match `manifest.name` when provided.
- `panel.entry` is relative to the plugin root.
- The entry file should be HTML and can reference local CSS/JS files.

Errata serves plugin UI from:

- `GET /api/plugins/:pluginName/ui/` (entry HTML)
- `GET /api/plugins/:pluginName/ui/*` (assets relative to entry dir)

The app renders this panel in an iframe.

## Minimal UI Example

`ui/index.html`

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>My Plugin</title>
    <link rel="stylesheet" href="./panel.css" />
  </head>
  <body>
    <h1 id="title">My Plugin Panel</h1>
    <script src="./panel.js"></script>
  </body>
</html>
```

`ui/panel.css`

```css
body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 12px; }
```

`ui/panel.js`

```js
const params = new URLSearchParams(location.search)
const storyId = params.get('storyId')
document.getElementById('title').textContent = storyId
  ? `My Plugin Panel (${storyId})`
  : 'My Plugin Panel'
```

## Local Development Flow

### Template Catalog

Complete templates live in `plugins/templates/README.md`.

Examples include:

- `my-first-plugin`
- `recipe-fragment-type-plugin`
- `recipe-llm-tool-plugin`
- `recipe-story-fragments-plugin`
- `recipe-hooks-plugin`
- `recipe-iframe-ui-plugin`

Scaffold a plugin from template:

```bash
bun run new:plugin my-plugin
```

Use a specific complete recipe template:

```bash
bun scripts/new-plugin.mjs my-plugin --template recipe-llm-tool-plugin
```

Or target a custom plugin root:

```bash
bun scripts/new-plugin.mjs my-plugin /opt/errata/plugins
```

Then run Errata with `PLUGIN_DIR` pointing at that root.

1. Place plugin folder in your runtime plugin directory.
2. Start Errata with env vars:

Windows:

```bat
set PLUGIN_DIR=C:\path\to\plugins
bun run dev
```

macOS/Linux:

```bash
PLUGIN_DIR=/path/to/plugins bun run dev
```

3. Enable plugin in story settings (`enabledPlugins`).
4. Open plugin panel in sidebar.

### Validate in Dev as External Plugin

You can test exactly as production runtime plugins during local dev:

```bash
PLUGIN_DIR=/path/to/plugins bun run dev
```

Then verify:

- `GET /api/plugins` includes your plugin manifest
- plugin is enabled in story settings
- if `plugin.json.panel.entry` exists, panel is available via iframe

Windows example:

```bat
set PLUGIN_DIR=C:\path\to\plugins
bun run dev
```

### IDE Import Guidance

- Use SDK imports for plugin contracts (`@tealios/errata-plugin-sdk`).
- Only import Errata internals (`../../src/server/...`) for optional advanced recipes.
- If you need those internal imports with full IDE resolution, develop the plugin inside this monorepo (or symlink into it) while iterating.

## Name Conflicts

Plugins are keyed by `manifest.name`.

- Default: duplicate external plugin names are skipped.
- To allow external override:

```text
PLUGIN_EXTERNAL_OVERRIDE=1
```

## Security Notes

- External plugins execute arbitrary server code.
- Only load trusted plugins.
- Keep plugin directory write-restricted.
- Iframe UI is sandboxed, but still treat plugin UI as untrusted code.

## Clone-and-Run Example

```bash
git clone https://github.com/your-org/errata-plugin-foo /opt/errata/plugins/foo
PLUGIN_DIR=/opt/errata/plugins ./errata
```
