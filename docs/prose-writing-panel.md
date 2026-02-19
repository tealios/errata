# Prose Writing Panel

The Prose Writing Panel is a focused long-form editor for prose fragments, with inline AI selection transforms.

## Overview

- Opened from prose block actions (Edit) in `ProseChainView`.
- Uses Tiptap (`@tiptap/react` + `@tiptap/starter-kit`) for rich editing ergonomics while saving plain prose text.
- Supports quick passage switching from a sidebar, including chapter markers for context.
- Auto-saves on close/escape and when switching to another passage.

## Keyboard Shortcuts

- `Ctrl+S` / `Cmd+S` - save current prose fragment
- `Esc` - close panel (auto-save if dirty)

## Selection Transforms

When text is selected, a floating toolbar appears with built-in transforms:

- `Rewrite`
- `Expand`
- `Compress`

Custom transforms are also supported via `useWritingTransforms()` (`src/lib/theme.tsx`) and appear as additional buttons.

Transform requests stream back text and optional reasoning; the selected range is replaced in-place.

## API Endpoint

Selection transforms are powered by:

`POST /stories/:storyId/librarian/prose-transform`

Body shape (`src/server/api.ts`):

```json
{
  "fragmentId": "pr-ab12",
  "selectedText": "She entered the room.",
  "operation": "rewrite",
  "instruction": "optional for custom mode",
  "sourceContent": "optional full prose",
  "contextBefore": "optional local context",
  "contextAfter": "optional local context"
}
```

Response is NDJSON (`application/x-ndjson`) with event types:

- `text`
- `reasoning`
- `tool-call`
- `tool-result`
- `finish`

## Data Flow

1. User opens the writing panel for a prose fragment.
2. Editor content is initialized from the fragment and tracked for dirty state.
3. Save writes back through `api.fragments.update(...)`.
4. Selection transforms call `api.librarian.transformProseSelection(...)`.
5. Returned text replaces selection in editor; user can keep editing and save.

## Component/Route Map

- `src/components/prose/ProseWritingPanel.tsx`
- `src/components/tiptap/FloatingElement.tsx`
- `src/components/prose/ProseBlock.tsx` (entry action)
- `src/components/prose/ProseChainView.tsx` (panel handoff)
- `src/routes/story.$storyId.tsx` (overlay mount)
- `src/lib/api/librarian.ts` (client API)
- `src/server/librarian/prose-transform.ts` (agent implementation)

## Tests

- `tests/api/prose-edit-reanalysis.test.ts`
- `tests/librarian/refine.test.ts`
