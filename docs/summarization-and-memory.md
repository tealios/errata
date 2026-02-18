# Summarization and Story Memory

This document describes how Errata maintains long-term story memory, how deferred summary application works, and how summary compaction prevents unbounded summary growth.

## Overview

Errata uses a rolling `story.summary` string as memory for prose that has fallen outside the active prose context window.

The pipeline is:

1. A prose fragment is generated/saved.
2. Librarian analyzes that fragment and produces `summaryUpdate` and optional `structuredSummary` signals.
3. Deferred summary application appends eligible `summaryUpdate` entries into `story.summary`.
4. Summary compaction runs when needed to keep `story.summary` bounded.

Key implementation file:

- `src/server/librarian/agent.ts`

## Data Model

Story settings now include:

```ts
summaryCompact: {
  maxCharacters: number
  targetCharacters: number
}
```

Defaults:

- `maxCharacters: 12000`
- `targetCharacters: 9000`

Schema source:

- `src/server/fragments/schema.ts`

API settings PATCH support:

- `src/server/api.ts`
- `src/lib/api/settings.ts`

## Deferred Summary Application

Function:

- `applyDeferredSummaries(...)` in `src/server/librarian/agent.ts`

Inputs:

- `state.summarizedUpTo` (watermark)
- active prose chain order
- `summarizationThreshold`
- latest librarian analysis per prose fragment (`summaryUpdate`)

### Latest-analysis dedupe

Reanalysis can create multiple analysis records for the same prose fragment. Deferred application now resolves each `fragmentId` to the latest analysis first, then applies summaries using that deduped set.

Selection rules:

- prefer newest `createdAt`
- break timestamp ties by lexicographically larger analysis `id`

Implementation:

- `selectLatestAnalysesByFragment(...)` in `src/server/librarian/storage.ts`
- used by deferred summary application in `src/server/librarian/agent.ts`

### Threshold semantics

`summarizationThreshold` defines how many most-recent prose positions are *not yet folded* into rolling summary.

Given `proseIds.length = N`, the apply cutoff is:

- `cutoffIndex = max(0, N - summarizationThreshold)`

Only prose in `[startIndex, cutoffIndex)` are candidates, where:

- `startIndex = indexOf(summarizedUpTo) + 1`

### Contiguous watermark behavior

Application is contiguous. The algorithm stops at first gap:

- missing analysis for a prose ID, or
- analysis exists but `summaryUpdate` is empty/whitespace.

This guarantees `summarizedUpTo` does not leap over missing data.

Diagnostic logs emitted on stop:

- `gapFragmentId`
- `gapReason` (`missing_analysis` | `empty_summary_update`)

### State update rules

If one or more contiguous updates are applied:

- append joined updates to `story.summary`
- advance `state.summarizedUpTo` to last applied prose ID

If none are applicable:

- no summary append
- watermark unchanged

## Summary Compaction

Compaction function:

- `compactSummaryByCharacters(summary, maxCharacters, targetCharacters)`

Strategy:

- If `summary.length <= maxCharacters`, keep as-is.
- Otherwise compact toward `targetCharacters`.
- Current implementation preserves the newest tail of summary text (prefixed with `... `), prioritizing recent continuity.

Behavioral implications:

- Memory stays bounded for very long stories.
- Older summary detail is discarded first.

### Guardrails

Runtime clamp behavior:

- both values minimum 100
- `targetCharacters <= maxCharacters`

## Context Builder Interaction

The rolling summary appears in prompt context as `Story Summary So Far` (unless excluded by options such as `excludeStorySummary` in specialized flows).

When building `summaryBeforeFragmentId`, context rebuild also uses the same latest-analysis dedupe to avoid stale reanalysis summaries.

Relevant file:

- `src/server/llm/context-builder.ts`

## Tests

Primary tests:

- `tests/librarian/agent.test.ts`

Important coverage:

- contiguous application does not skip gaps
- compaction enforces bounded summary length
- deferred apply uses latest analysis per fragment
- librarian can derive `summaryUpdate` from structured signals when summary text is empty

Related context tests:

- `tests/llm/context-builder.test.ts`

## Operational Notes

- For short stories, defaults are usually sufficient.
- For long-running projects, tune `summaryCompact` in Settings:
  - increase `maxCharacters` for richer memory at higher token cost
  - lower `targetCharacters` for more aggressive compaction
- If summaries stall, check for gap logs from deferred application.

## Known Limitations

- Compaction is character-based, not semantic; it can drop useful older context.
- Structured summary signals are optional and quality depends on model/tool-call discipline.
- Hierarchical summaries (micro/meso/macro) are not yet implemented.
