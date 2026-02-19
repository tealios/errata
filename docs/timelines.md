# Timelines

Timelines let you explore alternate story directions without losing previous work. Each timeline is a complete, isolated copy of the story's content — prose, fragments, librarian state, and all metadata — that can be edited independently.

Internally, timelines are called "branches". The user-facing term is "Timelines".

## Overview

Every story starts with a single timeline called **Main**. When you create a new timeline, Errata copies the entire content directory of the parent timeline into a new directory. From that point on, the two timelines are fully independent — edits, generations, and librarian analyses in one timeline never affect another.

The active timeline determines which content is loaded for all operations. Switching timelines swaps the active content root, and all subsequent reads, writes, and generations use that timeline's data.

## Data Structure

```
data/stories/{storyId}/
  meta.json                    # Story metadata (shared across timelines)
  branches.json                # Timeline index: list of branches + active branch ID
  branches/
    main/
      prose-chain.json
      fragments/
      associations.json
      generation-logs/
      librarian/
    {branchId}/
      prose-chain.json
      fragments/
      associations.json
      generation-logs/
      librarian/
```

Story-level metadata (`meta.json`) is shared across all timelines. Everything under `branches/{id}/` is timeline-specific.

## Schema

### BranchMeta

```ts
interface BranchMeta {
  id: string               // "main" or "br-{12-char-alphanumeric}"
  name: string             // User-facing name (max 100 chars)
  order: number            // Display order
  parentBranchId?: string  // Parent timeline (for lineage tracking)
  forkAfterIndex?: number  // Prose section index where the fork occurred
  createdAt: string        // ISO 8601 datetime
}
```

### BranchesIndex

```ts
interface BranchesIndex {
  branches: BranchMeta[]   // All timelines for the story
  activeBranchId: string   // Currently active timeline
}
```

## Content Root Resolution

All fragment, prose chain, and librarian operations go through `getContentRoot(dataDir, storyId)`, which returns the directory path for the currently active timeline. This is the key abstraction that makes timeline isolation transparent to the rest of the codebase.

```ts
// Returns: data/stories/{storyId}/branches/{activeBranchId}
const root = await getContentRoot(dataDir, storyId)
```

There is also `getContentRootForBranch(dataDir, storyId, branchId)` for operations that need to target a specific timeline (e.g., branch creation).

## Migration

Stories created before the timeline system have their content at the story root level. On first access, `migrateIfNeeded()` detects this layout and moves all content into `branches/main/`, then creates the initial `branches.json`. This migration runs once per story and is cached in memory.

Content items that are migrated:

- `prose-chain.json`
- `fragments/`
- `associations.json`
- `generation-logs/`
- `librarian/`
- `block-config.json`

## Creating a Timeline

`createBranch(dataDir, storyId, name, parentBranchId, forkAfterIndex?)` performs these steps:

1. Generates a unique branch ID (`br-{12-char-alphanumeric}`)
2. Copies the parent timeline's entire directory recursively
3. If `forkAfterIndex` is provided, truncates the prose chain to `entries.slice(0, forkAfterIndex + 1)`
4. Writes the new branch metadata to `branches.json`
5. Sets the new branch as active

The `forkAfterIndex` parameter enables forking mid-story. For example, if the prose chain has 5 sections and you fork at index 2, the new timeline gets sections 0-2 and you can write an alternate continuation from that point.

## Forking from Prose

Each prose section in the chain view has a **Timeline** button (git-branch icon). Clicking it:

1. Prompts for a timeline name
2. Calls `createBranch()` with `forkAfterIndex` set to that section's index
3. Switches to the new timeline
4. The user can now generate from the fork point, creating an alternate path

This is the primary way users create divergent story lines.

## Switching Timelines

`switchActiveBranch()` updates `activeBranchId` in `branches.json`. All subsequent operations (fragment reads, prose chain access, generation, librarian) automatically use the new timeline's content directory.

## Deleting a Timeline

`deleteBranch()` removes the branch directory entirely and cleans up `branches.json`. If the deleted timeline was active, it falls back to `main`. The `main` timeline cannot be deleted.

## Renaming a Timeline

`renameBranch()` updates the branch name in `branches.json`.

## Librarian Integration

Each timeline has its own `librarian/` directory containing:

- Librarian state (last analyzed fragment, recent mentions, timeline events)
- Analysis records
- Chat history

When a timeline is created, the parent's librarian data is copied along with everything else. From that point, librarian analyses and chat sessions are independent per timeline.

## API Endpoints

All endpoints are under `/api/stories/:storyId/branches`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/branches` | List all timelines and the active timeline ID |
| `POST` | `/branches` | Create a new timeline (body: `{ name, parentBranchId, forkAfterIndex? }`) |
| `PATCH` | `/branches/active` | Switch active timeline (body: `{ branchId }`) |
| `PUT` | `/branches/:branchId` | Rename a timeline (body: `{ name }`) |
| `DELETE` | `/branches/:branchId` | Delete a timeline |

## UI Components

### TimelineTabs

A horizontal tab bar at the top of the prose editor. Only visible when more than one timeline exists. Each tab shows the timeline name with a git-branch icon (except Main). The active tab is highlighted. Includes:

- Click a tab to switch timelines
- `...` menu on the active tab: Rename, Delete (disabled for Main)
- `+` button to create a new timeline from the current one
- Eye-off button to hide the bar (re-show via settings)

### TimelineManagerPanel

A sidebar panel with a full list of timelines, showing parentage info ("from Main at section 2") and action buttons. Provides the same operations as TimelineTabs in a more detailed layout.

## File Reference

| File | Purpose |
|---|---|
| `src/server/fragments/branches.ts` | Core branching logic: migration, CRUD, content root resolution. Uses `withBranch()` for branch-aware storage in agent and generation code. |
| `src/server/fragments/schema.ts` | `BranchMetaSchema`, `BranchesIndexSchema` |
| `src/lib/api/branches.ts` | Frontend API client |
| `src/lib/api/types.ts` | `BranchMeta`, `BranchesIndex` TypeScript types |
| `src/lib/fragment-ids.ts` | `generateBranchId()` |
| `src/components/prose/TimelineTabs.tsx` | Top bar tab component |
| `src/components/sidebar/TimelineManagerPanel.tsx` | Sidebar management panel |
| `src/components/prose/ProseBlock.tsx` | "Timeline" button on prose sections |
| `src/routes/story.$storyId.tsx` | Route integration, query hooks, visibility state |
| `tests/fragments/branches.test.ts` | Branch CRUD and isolation tests |
