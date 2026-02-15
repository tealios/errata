# Plugin Template Catalog

This directory contains complete, copy-ready plugin recipes.

## Available Templates

- `my-first-plugin`
  - All-in-one starter with fragments, tools, routes, hooks, and iframe UI.
- `recipe-fragment-type-plugin`
  - Demonstrates registering a custom fragment type and exposing helpers for it.
- `recipe-llm-tool-plugin`
  - Demonstrates calling the story's configured LLM from plugin tools/routes.
- `recipe-story-fragments-plugin`
  - Demonstrates reading/updating/deleting fragments in a story safely.
- `recipe-hooks-plugin`
  - Demonstrates lifecycle hooks (`beforeContext`, `afterSave`).
- `recipe-iframe-ui-plugin`
  - Demonstrates runtime iframe UI (`plugin.json` + `ui/*`) with plugin API routes.

## Usage

Scaffold directly from a template:

```bash
bun scripts/new-plugin.mjs my-plugin --template recipe-llm-tool-plugin
```

Default scaffold command:

```bash
bun run new:plugin my-plugin
```

Copy one template folder into your plugin root (`PLUGIN_DIR`) and rename:

```bash
cp -R plugins/templates/recipe-llm-tool-plugin /path/to/plugins/my-plugin
```

Then update:

- `manifest.name`
- `plugin.json.name` (if present)
- `manifest.description` and `manifest.panel.title`

All templates use the SDK package for plugin contracts:

- `@tealios/errata-plugin-sdk`
