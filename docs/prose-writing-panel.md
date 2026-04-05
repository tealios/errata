# Prose Writing Panel

The Prose Writing Panel is a focused long-form editor for prose fragments, paired with a prose chain view that supports inline generation, variations, librarian actions, and timeline forking.

## Overview

- Opened from prose block actions (Edit) in `ProseChainView`.
- Uses Tiptap (`@tiptap/react` + `@tiptap/starter-kit`) for rich editing ergonomics while saving plain prose text.
- Supports quick passage switching from a sidebar, including chapter markers for context.
- Auto-saves on close/escape and when switching to another passage.
- The surrounding prose chain view is virtualized for long stories and preserves scroll position per story.

## Keyboard Shortcuts

- `Ctrl+S` / `Cmd+S` — save current prose fragment
- `Esc` — close panel (auto-save if dirty)
- `Alt+Up` / `Alt+Down` — navigate to previous/next passage

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

## Context Strips

The editor shows context strips above and below the editing area:

- **Previous passage strip** — shows a truncated preview of the preceding passage in the prose chain, providing continuity context while writing.
- **Next passage strip** — shows a truncated preview of the following passage.

Context strips are only shown when adjacent passages exist. They help authors maintain flow without needing to scroll through the full prose chain.

## Prose Sidebar

A collapsible sidebar lists all prose passages and chapter markers, with:

- **Search** — filter passages by content
- **Chapter markers** — displayed as section headers with bookmark icons
- **Save state indicators** — green checkmark (saved), yellow dot (unsaved)
- **Quick navigation** — click any passage to switch to it (auto-saves current if dirty)

The sidebar can be collapsed to maximize editor space. Toggle with the panel icon in the header.

## Editor Stats

The status bar shows real-time statistics for the current passage:

- Word count
- Character count
- Estimated token count
- Paragraph count
- Estimated reading time

## Dialogue Formatting

Prose blocks automatically italicize quoted dialogue for visual distinction. This uses `formatDialogue` from `src/lib/character-mentions.ts`, composed with mention highlighting via `composeTextTransforms`. The formatting is display-only — the underlying fragment content is unchanged.

## Generation Abort

Generation can be aborted mid-stream. The `InlineGenerationInput` component provides a pause button during active generation. The abort signal is propagated from the client through `AbortController` to the server stream. Any text produced before the abort is saved as a partial prose fragment.

## Guided Mode

The inline generation input supports three modes:

- **Freeform** — standard text input for custom author directions.
- **Guided** — displays direction suggestion cards from the librarian's latest analysis. Clicking a card fills the generation input with its instruction. A refresh button requests new suggestions on demand.
- **Compose** — bypasses generation and lets you write a new prose section directly into the chain.

Guided mode also includes quick actions for:

- **Continue** — advance the plot naturally
- **Scene-setting** — focus on atmosphere and character moments

Mode preference is persisted in `localStorage`.

## Inline Prose Actions

Each prose block in the chain view exposes an action menu with operations around the writing panel:

- **Edit** — opens the full Prose Writing Panel
- **Redo** — regenerate from the original prompt/description
- **Ask / Refine** — open the librarian with the fragment prefilled
- **Analyze** — trigger librarian analysis manually for that prose fragment
- **Split from here** — create a new timeline fork from that section
- **Variation switching** — move between alternate versions of the same section

When a prose fragment already has librarian analysis, the block shows a small green dot in the top-right corner.

## Cover Image Banner

When a story has a cover image set, `ProseChainView` renders a banner at the top of the scroll area above the prose chain. The banner displays the cover image with a gradient overlay fading into the background. The cover image is passed to the component via the `coverImage` prop from the story route.

## Outline and Reordering

The prose outline panel mirrors the current chain and can enter a reorder mode. Reordering updates the prose chain itself, so subsequent reading, generation context, and timeline forking all use the new section order.

## Data Flow

1. User opens the writing panel for a prose fragment.
2. Editor content is initialized from the fragment and tracked for dirty state.
3. Save writes back through `api.fragments.update(...)`.
4. Selection transforms call `api.librarian.transformProseSelection(...)`.
5. Returned text replaces selection in editor; user can keep editing and save.
6. Switching passages via sidebar or `Alt+Up/Down` auto-saves if dirty before loading the new passage.

## Component/Route Map

- `src/components/prose/ProseWritingPanel.tsx`
- `src/components/prose/InlineGenerationInput.tsx`
- `src/components/tiptap/FloatingElement.tsx`
- `src/components/prose/ProseBlock.tsx` (entry action)
- `src/components/prose/ProseChainView.tsx` (panel handoff)
- `src/components/prose/ProseOutlinePanel.tsx`
- `src/routes/story.$storyId.tsx` (overlay mount)
- `src/lib/api/librarian.ts` (client API)
- `src/server/librarian/prose-transform.ts` (agent implementation)

## Tests

- `tests/api/prose-edit-reanalysis.test.ts`
- `tests/librarian/refine.test.ts`
