# My First Plugin Template

This folder is a copy/paste starter for third-party plugin development.

See `plugins/templates/README.md` for other complete recipe templates.

## Quick Start

Scaffold from this template automatically:

```bash
bun run new:plugin my-plugin
```

1. Copy this folder to your plugin directory:
   - `PLUGIN_DIR/my-plugin/`
2. Rename `plugin.json` and `entry.server.js` values as needed.
3. Start Errata with `PLUGIN_DIR` set.
4. Enable your plugin in story settings.

If you publish this plugin as a standalone repo, add:

```bash
bun add @tealios/errata-plugin-sdk
```

## What This Template Includes

- `entry.server.js`: main plugin export with optional recipes wired in.
- `plugin.json`: runtime iframe panel metadata.
- `ui/`: minimal HTML/CSS/JS panel for runtime UI mode.
- `recipes/`: copy/paste snippets for common server plugin tasks.

## Recipe Index

- `recipes/register-fragment-type.js`
  - Add a custom fragment type with prefix and context behavior.
- `recipes/use-llm.js`
  - Call the configured story model via AI SDK.
- `recipes/use-story-fragments.js`
  - Read/update fragments in the current story.
- `recipes/add-api-routes.js`
  - Add plugin API routes under `/api/plugins/<name>/...`.
- `recipes/use-hooks.js`
  - Hook into context and post-save flow.

## Important Notes

- External runtime plugins are server code. Only install trusted plugins.
- Runtime UI panel mode uses iframe and static HTML/CSS/JS.
- In a plugin copied to `plugins/<name>/`, imports to app internals usually use `../../src/...`.
