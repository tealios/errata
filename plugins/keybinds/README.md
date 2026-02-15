# Keybinds Plugin

Configurable keyboard shortcuts for story editing.

## Actions

- Jump to bottom
- Jump between prose passages (next/previous)
- Collapse/expand outline panel
- Close fragment view panel

## Notes

- Bindings are story-specific and saved in localStorage.
- Runtime listener is started from `entry.client.ts` and works while the story page is open.
- Plugin sidebar icon is configured in `plugin.ts` via `manifest.panel.icon`.
