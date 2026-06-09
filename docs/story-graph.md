# Story Graph System

A design spec for a standalone **story graph** subsystem: a derived, queryable
graph of the story that any part of the app can traverse. Its first consumer is
the librarian (which mounts graph tools), but the graph is **not a librarian
feature** — it is an isolated system with a neutral query API that search,
generation context, and the UI can adopt later without touching its internals.

> **Status:** design proposal. No implementation yet. v1 scope is **structural
> only** — the graph is assembled entirely from data that exists for every story,
> with no additional LLM calls and **no dependency on the librarian having run**.

## 1. Motivation

Two problems, one structure:

1. **Traversal.** The librarian "traverses" the story with three blunt tools
   (`listFragments`, `searchFragments` — case-insensitive substring — and
   `getFragment`). It cannot cheaply answer structural questions: *which scenes
   does character A appear in, in order; how is A connected to location B; what
   scenes advance this thread; what touches this scene; what's orphaned.*
2. **Reuse.** That same structural index is exactly what a future **search**
   feature, **generation context selection**, or a **story-map UI** would want. If
   we bolt the graph onto the librarian, every other consumer has to reach through
   the librarian to get it. It needs to stand alone.

So the graph is built as its own subsystem with a public query API. The librarian
is the first consumer; others plug into the same API.

### Data that already encodes edges

Crucially, **most edges come from data that exists for every story regardless of
whether the user runs the librarian.** Analysis-derived data is an optional
enrichment, not a prerequisite.

| Source | Edges | Always present? |
|---|---|---|
| `associations.json` → `refIndex` (+ `__backref:<id>`) | `fragment → fragment` references (bidirectional) | **Yes** |
| `associations.json` → `tagIndex` | `tag → fragment[]` | **Yes** |
| `prose-chain.json` + `marker` fragments | `prose → prose → chapter` sequence | **Yes** |
| `fragment.refs` (schema field) | `fragment → fragment` references | **Yes** |
| `summary` fragments `meta.coverageStart/End` | `summary → prose` coverage | **Yes** (if summaries exist) |
| Librarian analysis `mentions` | `prose → character` | No — enrichment |
| Analysis `structuredSummary.openThreads` | `thread` nodes | No — enrichment |
| Analysis `timelineEvents` | `prose → event` | No — enrichment |
| Analysis `contradictions` | `fragment ↔ fragment` conflict | No — enrichment |

A story with zero librarian runs still produces a useful graph (scenes in order,
chapters, refs, shared tags). Running the librarian *enriches* it.

## 2. Principles

### 2a. The graph is a projection, not a source of truth

This mirrors the existing `rebuildAnalysisIndex` pattern in
`src/server/librarian/storage.ts`. The story graph is a **derived index**:

- **Always rebuildable** from fragments + associations + prose-chain (+ analyses
  if present). A corrupt or stale graph is never data loss — call
  `rebuildStoryGraph`.
- **Never authoritative.** Nothing writes a fact *only* to the graph. Edges carry a
  `source` tag identifying which mechanism produced them, so the graph is
  reproducible and auditable.
- **Per-branch and atomic.** Stored at `<contentRoot>/graph.json` via
  `getContentRoot(dataDir, storyId)` and `writeJsonAtomic` — exactly like
  `associations.json`, `prose-chain.json`, and `librarian/index.json`. It follows
  branch switches automatically.

### 2b. The graph is isolated — dependencies point *inward*

`src/server/graph/` imports from the data layer (`fragments`, `associations`,
`prose-chain`) only. It **must not import from `src/server/librarian/`** or any
consumer. The dependency arrow is one-directional:

```
librarian ─┐
search    ─┼─► graph ─► fragments / associations / prose-chain
generation ┘
```

Consumers depend on the graph; the graph depends on nobody but the data layer.
Analysis-derived edges are fed *in* through a narrow, optional interface (§6.4) —
the graph never reaches *out* to call the librarian. This is what lets search (or
anything else) adopt it later without entangling the librarian.

## 3. Data model

### Nodes

One node per non-archived fragment. Thread/event nodes are **enrichment-only** —
present only when analyses exist; the graph is fully functional without them.

```ts
type GraphNodeKind =
  | 'scene'      // prose fragment            (structural)
  | 'character'  // character fragment        (structural)
  | 'knowledge'  // knowledge fragment        (structural)
  | 'guideline'  // guideline fragment        (structural)
  | 'chapter'    // marker fragment           (structural)
  | 'summary'    // summary fragment          (structural)
  | 'thread'     // derived open story thread (enrichment)
  | 'event'      // derived timeline event    (enrichment)

interface GraphNode {
  id: string            // fragment id (pr-…, ch-…) or derived id (th-…, ev-…)
  kind: GraphNodeKind
  label: string         // fragment name, or thread/event text
  fragmentId?: string   // present for fragment-backed nodes
  meta?: Record<string, unknown>
}
```

Fragment kinds map from `fragment.type`; custom/plugin types fall back to a generic
node so user-defined content is never dropped. Derived node ids use the
`<prefix>-<slug>` convention (`th-`, `ev-`), generated deterministically from
normalized text so re-runs are idempotent.

### Edges

Directed, typed, deduplicated, with provenance and an optional weight. Grouped by
whether they require analysis.

```ts
type GraphEdgeKind =
  // ── structural (always available) ──
  | 'sequence'     // scene → scene (prose-chain order); scene → chapter (membership)
  | 'references'   // fragment → fragment (refs / associations)
  | 'shares_tag'   // fragment ↔ fragment via a shared tag (tag in meta)
  | 'summarizes'   // summary → scene (coverage)
  // ── enrichment (only when analyses exist) ──
  | 'mentions'     // scene → character
  | 'appears_in'   // character → scene (inverse of mentions; for arc walks)
  | 'introduces'   // scene → thread
  | 'advances'     // scene → thread
  | 'resolves'     // scene → thread
  | 'occurs'       // scene → event
  | 'contradicts'  // fragment ↔ fragment

interface GraphEdge {
  from: string
  to: string
  kind: GraphEdgeKind
  source: 'prose-chain' | 'associations' | 'summary' | 'analysis'
  weight?: number       // e.g. mention count, shared-tag count
  meta?: Record<string, unknown> // e.g. { tag, analysisId, position }
  enrichment?: true     // marks analysis-derived edges for easy filtering/pruning
}
```

`shares_tag` is high-fanout; v1 caps it (only materialize when a tag links ≤ N
fragments, configurable) so a "main-character" tag doesn't create a clique.

### Top-level document

```ts
interface StoryGraph {
  version: 1
  updatedAt: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  builtFromAnalysisUpdatedAt?: string // watermark for the optional enrichment feed
}
```

## 4. Module layout

New directory `src/server/graph/`, isolated (§2b) and shaped like a data subsystem,
not an agent:

| File | Responsibility |
|---|---|
| `schema.ts` | Zod schemas + TS types for `GraphNode`, `GraphEdge`, `StoryGraph`. |
| `build.ts` | `buildStoryGraph(dataDir, storyId)` — assemble the **structural** graph from fragments, associations, prose-chain. No librarian imports. |
| `enrich.ts` | `enrichFromAnalyses(graph, dataDir, storyId)` — optional pass that folds analysis-derived nodes/edges into an existing graph. Reads analysis *artifacts* (the stored JSON), not the librarian runtime. |
| `storage.ts` | `getStoryGraph`, `saveStoryGraph`, `rebuildStoryGraph`, `markGraphStale` — atomic per-branch persistence. |
| `query.ts` | Pure, side-effect-free graph algorithms over an in-memory `StoryGraph` (§5). Independently testable with hand-built graphs. |
| `tools.ts` | `createGraphTools(dataDir, storyId)` — a **generic** `ai` SDK tool factory. Any agent can mount it; it has no librarian-specific logic. |

Tests under `tests/graph/`: `build.test.ts` (incl. a story with **zero analyses**),
`enrich.test.ts`, `query.test.ts`, `storage.test.ts`, `tools.test.ts` — matching the
existing `tests/librarian/` layout and Vitest setup.

> Note `enrich.ts` reads stored analysis JSON via the librarian storage's *read*
> helpers (or a thin re-export), which is data access, not a runtime dependency on
> the librarian agent. If we want the boundary airtight, the analysis read helpers
> can move to a shared `server/analyses/` data module that both graph and librarian
> import. Decision deferred to implementation.

## 5. Query layer

Pure functions over an in-memory graph (adjacency built once per call), neutral to
any consumer:

```ts
neighbors(graph, nodeId, opts?: { kinds?; edgeKinds?; limit? }): GraphNode[]
subgraph(graph, nodeId, depth: number): StoryGraph
shortestPath(graph, fromId, toId): GraphEdge[] | null
characterArc(graph, characterId): GraphNode[]              // scenes in chain order
traceThread(graph, threadId): { introduced; advanced; resolved }
orphans(graph): GraphNode[]
contradictionClusters(graph): GraphNode[][]
storyMap(graph): { topCharacters; openThreads; chapters }  // compact overview
search(graph, query, opts?): GraphNode[]                   // label/kind match — seed for the future search consumer
```

All are O(V+E) BFS/DFS or simple scans — no external graph library needed. Queries
that depend on enrichment edges (`characterArc`, `traceThread`,
`contradictionClusters`) degrade gracefully to empty results on an unenriched
graph, never throw.

## 6. Consumers

The graph exposes the query API (§5) and a generic tool factory (`tools.ts`).
Consumers wire themselves to it; the graph knows nothing about them.

### 6.1 Librarian (first consumer, this initiative)

Mount `createGraphTools` into the librarian **chat** tool set in
`src/server/librarian/chat.ts` (where `allTools` is assembled), alongside the
existing `reanalyzeFragment` / `optimizeCharacter` / `inspectGeneration` tools:
`graphNeighbors`, `graphPath`, `characterArc`, `traceThread`, `findOrphans`. They
return compact node/edge summaries; the librarian drills into full content with the
existing `getFragment`.

Optionally add a compact `story-map` context block (via `librarian/blocks.ts`) from
`query.storyMap` — the *index page* that tells the librarian where to look before it
walks. Document the tools in `CHAT_SYSTEM_PROMPT` / the `librarian.chat.system`
instruction key.

This is the only wiring built now. Everything below is future work the isolation
buys us — listed to validate the boundary, not to build yet.

### 6.2 Search (future)

A story-wide search can rank/expand results via `query.search` + `neighbors`
(e.g. "find X, then everything connected to it"). It calls the same API directly —
no librarian involvement.

### 6.3 Generation context (future)

The graph could help *select* what the writer sees (e.g. pull the subgraph around
the active scene). Separate initiative once the graph is trusted.

### 6.4 Keeping the graph fresh (consumer-independent)

Freshness is driven by **structural** mutations, so the graph stays correct even
for users who never run the librarian:

- **Structural feed (primary):** fragment create/update/delete, association ref/tag
  changes, and prose-chain reorders/inserts mark the graph stale (or patch the
  affected `sequence` / `references` / `shares_tag` edges). This is the source of
  truth for graph currency.
- **Enrichment feed (optional):** after `saveAnalysis`, the librarian *notifies* the
  graph (a one-line call into `enrich`/`markGraphStale`) to fold in
  mentions/threads/events/contradictions and advance
  `builtFromAnalysisUpdatedAt`. If this feed never fires (librarian unused), the
  graph is still complete on its structural axis.
- **Full rebuild:** `rebuildStoryGraph` (build + optional enrich) — the safety net,
  exactly like the analysis-index rebuild.

## 7. API surface

A thin route module `src/server/routes/graph.ts` (Elysia, matching
`routes/librarian.ts`) — owned by the graph subsystem, usable by any client:

| Route | Purpose |
|---|---|
| `GET /api/stories/:id/graph` | Current graph (build-on-demand if missing). |
| `POST /api/stories/:id/graph/rebuild` | Force full rebuild (+ enrich if analyses exist). |
| `GET /api/stories/:id/graph/query` | Run a named query (`neighbors`/`path`/`arc`/`search`/…). |

Typed client additions in `src/lib/api/`, matching the existing convention.

## 8. UI (optional, later phase)

A force-directed **story-map panel** — filter by node/edge kind, click a node to
open the fragment. Secondary to the backend ask. Must respect `.impeccable.md`
(warm, bookish, restrained — not a neon SaaS network diagram; honor
`prefers-reduced-motion`).

## 9. Phasing

1. **Graph core (structural)** — `schema` + `build` + `storage` +
   `rebuildStoryGraph` endpoint + tests, including a **zero-analysis story**.
   Pure projection from always-present data. **No behavior change**, no consumers
   yet — ships safely and stands alone.
2. **Query layer** — `query.ts` (§5) + unit tests over hand-built graphs.
3. **Enrichment feed** — `enrich.ts` + the optional `saveAnalysis` notification.
   Graph gains analysis edges *when present*, still correct when absent.
4. **Librarian tools + story-map block** — wire §6.1. This is where the librarian
   "traverses better." First and only consumer for now.
5. **Other consumers / UI** *(optional, later)* — search adapter, generation
   context, visualization panel.

## 10. Risks & decisions

- **Isolation boundary.** The one place coupling could creep in is `enrich.ts`
  reading analysis JSON. Keep it to *data reads* (or extract a shared
  `server/analyses/` data module) so `graph` never imports librarian runtime. The
  notification in §6.4 is librarian → graph, never the reverse.
- **Works without the librarian.** Build and all structural queries must pass on a
  story with zero analyses — covered by a dedicated test. Enrichment-only queries
  return empty, never throw.
- **Staleness vs. cost.** Structural patches keep the common path cheap; the
  watermark + rebuild endpoint cover drift.
- **Edge explosion.** `shares_tag` is capped; high-fanout tags are skipped or
  down-weighted.
- **Branches.** Stored under `getContentRoot`, so each branch has its own graph —
  consistent with every other per-story index.
- **Derived-node identity.** Thread/event ids are derived deterministically from
  normalized text (same discipline as `normalizeUniqueLines`) so repeated analyses
  converge instead of duplicating.

## 11. Out of scope for v1

- LLM-extracted semantic edges (causality, explicit relationships, location
  membership) — a later enrichment pass; carries LLM cost.
- Cross-story / series-level graphs.
- Building the search and generation consumers (§6.2–6.3) — the isolation is
  designed *for* them, but only the librarian adapter ships now.
