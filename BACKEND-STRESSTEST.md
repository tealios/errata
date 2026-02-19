# Backend Stress Test Plan (200k+ Word Stories)

This document defines the implementation and validation plan for summary and context scalability in long-running stories.

Scope: the 7 summary-system improvements identified during architecture review.

---

## Goals

- Keep generation context accurate and bounded as prose grows.
- Prevent summary drift, omission, and runaway token growth.
- Ensure librarian and context assembly performance remains predictable at scale.
- Maintain deterministic behavior under edits, regenerations, and branch/variation workflows.

---

## Baseline Stress Profile

Use this profile for all acceptance checks:

- Story size: 2,000 prose fragments (~100 chars to 2,000 chars each), target total 200k-400k words.
- Analyses: 1 analysis per prose fragment + 10% reanalysis overlap.
- Fragment library: 300-1,000 non-prose fragments (character/guideline/knowledge).
- Branching: 1 active branch, 2-5 inactive variations every 50 sections.


Primary KPIs:

- `buildContextState` latency (p50/p95).
- Librarian apply cycle latency.
- Size of `story.summary` over time.
- Summary correctness (no future leakage, no skipped eligible fragments).

---

## 1) First-Class Summary Compaction

### Problem

`story.summary` grows append-only and eventually consumes context budget.

### Implementation Plan

1. Add summary budget settings to story settings (chars or estimated tokens), e.g.:
   - `summaryCompact.maxCharacters`
   - `summaryCompact.targetCharacters`
2. In deferred summary apply path, check projected summary length before append.
3. If budget exceeded, run compaction pass:
   - Input: current summary + pending updates.
   - Output: rewritten condensed summary preserving continuity-critical facts.
4. Store summary metadata:
   - `summaryVersion`
   - `summaryCompactedAt`
   - `summarySourceWindow` (optional diagnostics).

### Tests

- Unit: compaction triggered when threshold exceeded.
- Unit: compaction output length under target.
- Integration: generation context includes compacted summary and remains coherent.

### Exit Criteria

- Summary length plateaus under configured budget for 10k+ fragment simulation.

---

## 2) Watermark Correctness (Contiguous Progress)

### Problem

`summarizedUpTo` can advance past gaps if missing analyses exist, causing permanent omissions.

### Implementation Plan

1. Change deferred apply algorithm to walk prose IDs from current watermark forward.
2. Stop at first fragment without usable summary update.
3. Only advance `summarizedUpTo` to last contiguous applied fragment.
4. Emit structured logs for gap detection:
   - `gapFragmentId`
   - `gapReason` (`missing_analysis`, `empty_summary_update`).

### Tests

- Unit: missing middle analysis blocks watermark advancement.
- Unit: late-arriving missing analysis allows next run to continue.

### Exit Criteria

- No skipped eligible fragment in replay test of out-of-order analysis writes.

---

## 3) Latest-Analysis-Per-Fragment Dedupe

### Problem

Reanalysis creates multiple analyses per fragment; summary rebuild/apply can use stale versions.

### Implementation Plan

1. Build a resolver that maps `fragmentId -> latest analysis` (prefer newest `createdAt`).
2. Use resolver in:
   - deferred summary apply,
   - `summaryBeforeFragmentId` rebuild path.
3. Keep raw history for audit, but consume only the latest entry for summary math.

### Tests

- Unit: two analyses for same fragment, only newest contributes.
- Integration: regenerate/refine uses deduped as-of summary.

### Exit Criteria

- Deterministic summary output regardless of historical duplicate analyses.

---

## 4) Structured Summary Updates (Not Free-Form Only)

### Problem

`summaryUpdate` free text quality varies and is hard to validate/compact reliably.

### Implementation Plan

1. Extend analysis tools schema with structured fields:
   - `events[]`
   - `stateChanges[]`
   - `openThreads[]`
2. Keep `summaryUpdate` as renderable text, but derive it from structured payload.
3. Add validators (length, duplicate suppression, required signal density).
4. Add render function to produce narrative summary for context blocks.

### Tests

- Unit: schema validation and canonical render from structured inputs.
- Snapshot: stable rendered summary style across runs.

### Exit Criteria

- At least 95% of librarian analyses in stress fixtures produce valid structured payloads.

---

## 5) Hierarchical Summaries (Micro / Meso / Macro)

Status: Implemented.

### Problem

Single rolling summary is overloaded; chapter summaries are disconnected from global context strategy.

### Implementation Plan

1. Define summary tiers:
   - Micro: per-fragment librarian summary.
   - Meso: chapter/arc summaries (marker-based).
   - Macro: global story summary.
2. Add assembly policy:
   - include macro always,
   - include relevant meso blocks for recent chapter window,
   - exclude micro from direct context unless needed.
3. Add periodic macro refresh from meso summaries to reduce drift.

### Tests

- Integration: context contains expected tiers per scenario.
- Regression: no future info leakage in regenerate mode.

### Exit Criteria

- Context payload shrinks while preserving continuity in long-story benchmark prompts.

---

## 6) Reanalysis Trigger on Prose Edits

Status: Implemented.

### Problem

Manual prose edits can invalidate prior summaries, mentions, contradictions, and suggestions.

### Implementation Plan

1. On prose update routes, detect material content change.
2. Trigger librarian analysis (debounced) for edited fragment.
3. Mark prior analysis as superseded (or rely on dedupe resolver from item #3).
4. Add guardrails for rapid edit sessions (coalesce events by fragment ID).
5. Make sure that we only target changes in name/description/content.

### Tests

- Integration: editing prose updates summary pipeline within debounce window.
- Integration: repeated edits produce one effective reanalysis in burst mode.

### Exit Criteria

- No stale summary metadata after manual edits in end-to-end tests.

---

## 7) Analysis Index for O(1) Lookup Paths

Status: Implemented.

### Problem

Current rebuild path scans many JSON files and repeatedly parses them.

### Implementation Plan

1. Add `librarian/index.json` with:
   - `latestByFragmentId`
   - optional ordered `appliedSummarySequence`.
2. Update index atomically on analysis save.
3. Refactor context-builder/deferred-apply to read index first, then only fetch required analysis files.
4. Add index rebuild utility for migration/recovery.

### Tests

- Unit: index updates correctly on create/reanalysis.
- Integration: context rebuild correctness matches non-index implementation.
- Performance: p95 context build latency improves significantly under 2,000+ analyses.

### Exit Criteria

- >=50% reduction in summary rebuild CPU/IO time in stress fixtures.

---

## Rollout Phases

### Phase A: Correctness Foundation

- #2 Watermark correctness
- #3 Latest-analysis dedupe
- #6 Reanalysis on prose edits

### Phase B: Scale Infrastructure

- #7 Analysis index
- #1 Summary compaction

### Phase C: Quality and Context Strategy

- #4 Structured updates
- #5 Hierarchical summaries

---

## Backward Compatibility + Migration

- Keep existing `summaryUpdate` string field during migration.
- Backfill index from existing analysis files on first startup or via admin task.
- Gate new behaviors with feature flags per story until validated:
  - `enableSummaryCompaction`
  - `enableStructuredSummary`
  - `enableHierarchicalSummary`

---

## Observability Additions

- Add metrics/events:
  - `summary.apply.count`
  - `summary.apply.skipped_gap`
  - `summary.compaction.count`
  - `summary.compaction.duration_ms`
  - `context.summary.rebuild.duration_ms`
  - `context.summary.length_chars`
- Add debug endpoint payload fields for summary provenance:
  - applied range, watermark, dedupe stats.

---

## Stress Test Matrix

Run each scenario with and without feature flags enabled:

1. Linear writing (2,000 fragments).
2. Heavy reanalysis (30% fragments reanalyzed).
3. Edit storm (rapid updates on same 50 fragments).
4. Branch-heavy storyline with inactive variations.
5. Regenerate/refine near the midpoint and near the end.

For each scenario collect:

- Correctness checks (no leak/no skip/no stale summaries).
- Latency p50/p95 for context build + librarian apply.
- Summary size trend over run duration.

---

## Definition of Done

- All 7 items implemented behind controlled rollout flags.
- Full stress matrix passing in CI/nightly benchmark runs.
- No regression in regenerate/refine temporal correctness tests.
- Summary context remains bounded and continuity quality remains stable in 200k+ word stories.
