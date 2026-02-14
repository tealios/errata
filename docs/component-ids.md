# Frontend Component ID Contract

This project uses `data-component-id` as the stable DOM hook for extensibility, plugin integration, and automation.

## Why this exists

- Plugins need predictable anchors to extend UI safely.
- E2E and integration tests need selectors that are stable across style/layout changes.
- We avoid global `id` collisions in repeated UI (lists, rows, nested panels).

## Canonical rule

- Use `data-component-id` for component hooks.
- Use HTML `id` only when strictly needed for native semantics (labels, anchors, etc.).

## Naming conventions

Use lowercase, kebab-case identifiers.

- Static nodes: `section-element`
  - Example: `character-sidebar-list`
- Dynamic entities: `<entity-prefix>-<entity-id>-<element>`
  - Example: `ch-abc123-list-item`
  - Example: `ch-abc123-pin-toggle`
- Plugin boundaries:
  - `plugin-panel-host`
  - `plugin-<pluginName>-panel-root`

## Helper utilities

Use helpers from `src/lib/dom-ids.ts`:

- `componentId(...parts)`
  - Sanitizes and joins parts to kebab-case.
- `fragmentComponentId(fragment, suffix)`
  - Produces stable fragment IDs using fragment type/prefix and fragment id.

## Current key anchors

### Sidebar and detail panels

- `story-sidebar`
- `sidebar-section-story-info`
- `sidebar-section-characters`
- `sidebar-section-guidelines`
- `sidebar-section-knowledge`
- `sidebar-section-media`
- `sidebar-section-agent-activity`
- `sidebar-section-settings`
- `detail-panel-root`
- `detail-panel-content`
- `detail-panel-section-<section>`

### Fragment lists

- `character-sidebar-list`
- `guideline-sidebar-list`
- `knowledge-sidebar-list`
- `media-sidebar-list`
- Dynamic rows and actions:
  - `ch-<id>-list-item`
  - `ch-<id>-select`
  - `ch-<id>-pin-toggle`
  - `ch-<id>-drag-handle`

> The same pattern applies to other prefixes (`gl`, `kn`, `pr`, `im`, `ic`).

### Prose and generation

- `prose-chain-root`
- `prose-chain-scroll`
- `prose-<fragmentId>-block`
- `prose-<fragmentId>-regenerate`
- `prose-<fragmentId>-refine`
- `inline-generation-root`
- `inline-generation-input`
- `inline-generation-submit`
- `debug-panel-root`
- `debug-log-<logId>-item`

### Route-level shells

- `stories-page`
- `story-list`
- `story-<storyId>-card`
- `story-editor-root`
- `main-prose-pane`
- `overlay-story-wizard`
- `overlay-debug-panel`
- `overlay-provider-panel`
- `overlay-fragment-editor-<mode>`

## Adding new IDs

When adding or changing UI:

1. Add `data-component-id` to extension boundaries and repeated item rows.
2. Prefer `componentId`/`fragmentComponentId` over hardcoded string concatenation.
3. Keep names semantic to feature + role (not style or visual position).
4. Preserve existing IDs unless there is a migration reason.

## Plugin author guidance

- Read anchors from the host app by `data-component-id`.
- Mount plugin UI inside `plugin-<pluginName>-panel-root` when applicable.
- Do not depend on Tailwind class names for integration.

## Testing guidance

- Prefer selectors like `[data-component-id="character-sidebar-list"]`.
- For dynamic rows, build selectors from known entity IDs.
- Avoid selectors tied to text content or visual class names when stable hooks exist.
