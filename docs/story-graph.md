# Story Graph System

A design spec for a derived **story graph** that gives the librarian a structural
map of the story to traverse — instead of brute-forcing `listFragments` +
substring `searchFragments` + `getFragment`.

> **Status:** design proposal. No implementation yet. v1 scope is **structural
> only** — the graph is assembled entirely from data that already exists, with no
> additional LLM calls.

## 1. Motivation

The librarian already produces graph-shaped data; it is just scattered across
separate files with no unified structure to walk. Today the librarian "traverses"
the story with three blunt tools (`listFragments`, `searchFragments` —
case-insensitive substring — and `getFragment`). It cannot answer structural
questions without reading large amounts of prose by hand:

- "Which scenes does character *A* appear in, in order?" (character arc)
- "How is character *A* connected to location *B*?" (path between nodes)
- "What scenes advance the *missing heir* thread?" (thread trace)
- "What touches this scene?" (neighborhood / subgraph)
- "Which fragments are orphaned, or sit in a contradiction cluster?"

### Data that already encodes edges

| Existing source | Implicit edges it already holds |
|---|---|
| `associations.json` → `refIndex` (+ `__backref:<id>`) | `fragment → fragment` references (already bidirectional) |
| `associations.json` → `tagIndex` | `tag → fragment[]` |
| Librarian analysis `mentions` (`analysis-tools.ts`) | `prose → character` |
| `LibrarianState.recentMentions` (`librarian/storage.ts`) | `character → prose[]` |
| Analysis `structuredSummary.openThreads` | latent plot-thread nodes |
| Analysis `timelineEvents` (`before`/`during`/`after`) | `prose → event` |
| Analysis `contradictions` (`fragmentIds[]`) | `fragment ↔ fragment` conflict edges |
| `prose-chain.json` + `marker` fragments | linear `prose → prose → chapter` sequence |
| `summary` fragments `meta.coverageStart/End`, `analysisIds` | `summary → prose` coverage |

The graph unifies these into one queryable structure.

## 2. Core principle: the graph is a projection, not a source of truth

This mirrors the existing `rebuildAnalysisIndex` pattern in
`src/server/librarian/storage.ts`. The story graph is a **derived index**
assembled from the sources of truth above. It is:

- **Always rebuildable** from fragments + associations + prose-chain + analyses.
  A corrupt or stale graph is never a data-loss event — call `rebuildStoryGraph`.
- **Never authoritative.** Nothing writes a fact *only* to the graph. Edges carry
  a `source` tag identifying which mechanism produced them, so the entire graph is
  reproducible and auditable.
- **Per-branch and atomic.** Stored at `<contentRoot>/graph.json` via
  `getContentRoot(dataDir, storyId)` and `writeJsonAtomic` — exactly like
  `associations.json`, `prose-chain.json`, and `librarian/index.json`. It follows
  branch switches automatically.

This keeps the graph honest: it is a fast, structured lens over data the app
already maintains, not a parallel database that can silently drift.

## 3. Data model

### Nodes

One node per non-archived fragment, plus lightweight derived nodes for the two
signals the librarian already emits but never materializes (threads, events).

```ts
type GraphNodeKind =
  | 'scene'      // prose fragment
  | 'character'  // character fragment
  | 'knowledge'  // knowledge fragment
  | 'guideline'  // guideline fragment
  | 'chapter'    // marker fragment
  | 'summary'    // summary fragment
  | 'thread'     // derived: an open story thread
  | 'event'      // derived: a timeline event

interface GraphNode {
  id: string            // fragment id (pr-…, ch-…) or derived id (th-…, ev-…)
  kind: GraphNodeKind
  label: string         // fragment name, or thread/event text
  fragmentId?: string   // present for fragment-backed nodes
  meta?: Record<string, unknown> // e.g. chapterId, position-in-chain, mentionCount
}
```

Fragment kinds map from `fragment.type` (custom types fall back to a generic
`knowledge`-like node so plugin types still appear). Derived node ids use the same
`<prefix>-<slug>` convention as `FragmentIdSchema` (`th-`, `ev-`), generated
deterministically from their text so re-runs are idempotent (no duplicate thread
nodes across analyses).

### Edges

Directed, typed, deduplicated, with provenance and an optional weight.

```ts
type GraphEdgeKind =
  | 'sequence'     // scene → scene (prose-chain order); scene → chapter (membership)
  | 'mentions'     // scene → character
  | 'appears_in'   // character → scene (inverse of mentions; materialized for arc walks)
  | 'references'   // fragment → fragment (from refs / associations)
  | 'shares_tag'   // fragment ↔ fragment via a shared tag (carries the tag in meta)
  | 'introduces'   // scene → thread
  | 'advances'     // scene → thread
  | 'resolves'     // scene → thread
  | 'occurs'       // scene → event
  | 'contradicts'  // fragment ↔ fragment
  | 'summarizes'   // summary → scene (coverage)

interface GraphEdge {
  from: string
  to: string
  kind: GraphEdgeKind
  source: 'prose-chain' | 'associations' | 'analysis' | 'state' | 'summary'
  weight?: number       // e.g. mention count, shared-tag count
  meta?: Record<string, unknown> // e.g. { tag, analysisId, position }
}
```

`shares_tag` can be high-fanout; v1 caps it (only materialize when a tag links ≤ N
fragments, configurable) so a "main-character" tag doesn't create a clique that
drowns the graph. `mentions` and `appears_in` are stored as a single logical edge
walked in either direction by the query layer rather than literally duplicated.

### Top-level document

```ts
interface StoryGraph {
  version: 1
  updatedAt: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  // watermark for incremental builds, like LibrarianState.summarizedUpTo
  builtFromAnalysisUpdatedAt?: string
}
```

## 4. Module layout

New directory `src/server/graph/`, following the shape of `src/server/librarian/`:

| File | Responsibility |
|---|---|
| `schema.ts` | Zod schemas + TS types for `GraphNode`, `GraphEdge`, `StoryGraph`. |
| `build.ts` | `buildStoryGraph(dataDir, storyId)` — assemble a full graph from fragments, associations, prose-chain, and analyses. Pure read, no writes. |
| `storage.ts` | `getStoryGraph`, `saveStoryGraph`, `rebuildStoryGraph`, `patchGraphForAnalysis` — atomic per-branch persistence, mirrors `librarian/storage.ts`. |
| `query.ts` | Pure, side-effect-free graph algorithms over an in-memory `StoryGraph` (see §5). Independently unit-testable with hand-built graphs. |
| `tools.ts` | `createGraphTools(dataDir, storyId)` — `ai` SDK tool wrappers around `query.ts`, in the style of `librarian/analysis-tools.ts` and `llm/tools.ts`. |

Tests under `tests/graph/`: `build.test.ts`, `query.test.ts`, `storage.test.ts`,
`tools.test.ts` — matching the existing `tests/librarian/` layout and Vitest setup.

## 5. Query layer

Pure functions over an in-memory graph (adjacency built once per call). These are
the operations the librarian can't do today:

```ts
neighbors(graph, nodeId, opts?: { kinds?; edgeKinds?; limit? }): GraphNode[]
subgraph(graph, nodeId, depth: number): StoryGraph        // BFS neighborhood
shortestPath(graph, fromId, toId): GraphEdge[] | null     // BFS, returns the walk
characterArc(graph, characterId): GraphNode[]             // scenes in prose-chain order
traceThread(graph, threadId): { introduced; advanced; resolved }
orphans(graph): GraphNode[]                               // degree-0 fragment nodes
contradictionClusters(graph): GraphNode[][]               // connected components over `contradicts`
storyMap(graph): { topCharacters; openThreads; chapters } // compact overview for context
```

All are O(V+E) BFS/DFS or simple scans — no external graph library needed for the
sizes involved (a long story is thousands of nodes, not millions). The
`BACKEND-STRESSTEST.md` harness can be extended to benchmark `buildStoryGraph` and
the hot query paths if needed.

## 6. Librarian integration

### 6a. New traversal tools

Add graph tools to the librarian **chat** tool set in
`src/server/librarian/chat.ts` (where `allTools` is assembled), alongside the
existing `reanalyzeFragment` / `optimizeCharacter` / `inspectGeneration` tools:

- `graphNeighbors(fragmentId, kinds?)` — what directly touches this node.
- `graphPath(fromId, toId)` — how two entities are connected.
- `characterArc(characterId)` — ordered scene list for a character.
- `traceThread(query)` — resolve a thread by text, return its introduce/advance/resolve scenes.
- `findOrphans()` — fragments connected to nothing (continuity gaps / dead lore).

These wrap `query.ts` and return compact node/edge summaries (ids + labels), so the
librarian drills into full content with the existing `getFragment` only where
needed.

### 6b. Story-map context block

Add a compact `story-map` block to the librarian chat/analyze context (via
`librarian/blocks.ts` and the `block-helpers`), produced by `query.storyMap`: top
characters by appearance count, current open threads, and chapter structure. This
is the *index page* — it tells the librarian where to look before it walks. It is
small (bounded lists), so it costs little context budget. Gated behind the block
system so power users can reorder/disable it like any other block.

### 6c. Prompt updates

Document the new tools in `CHAT_SYSTEM_PROMPT` (and the corresponding
`instructionRegistry` key `librarian.chat.system`) so the model knows to reach for
structural traversal instead of substring search.

### 6d. Keeping the graph fresh

- **Incremental:** after `saveAnalysis` in `librarian/agent.ts`, call
  `patchGraphForAnalysis` to upsert the nodes/edges from that one analysis
  (mentions, threads, events, contradictions) and advance the watermark — cheap,
  bounded work, same place the analysis index is already updated.
- **Structural mutations:** prose-chain reorders/inserts and association ref/tag
  changes mark the graph stale (or patch the affected `sequence` / `references` /
  `shares_tag` edges directly).
- **Full rebuild:** `rebuildStoryGraph` endpoint + a "Rebuild graph" affordance,
  exactly like the existing analysis-index rebuild — the safety net that
  guarantees the projection can always be reconciled with the sources of truth.

## 7. API surface

A thin route module `src/server/routes/graph.ts` (Elysia, matching
`routes/librarian.ts`):

| Route | Purpose |
|---|---|
| `GET /api/stories/:id/graph` | Current graph (build-on-demand if missing). |
| `POST /api/stories/:id/graph/rebuild` | Force full rebuild. |
| `GET /api/stories/:id/graph/query` | Run a named query (`neighbors`/`path`/`arc`/…) for the future UI. |

Typed client additions go in `src/lib/api/` to match the existing API-client
convention.

## 8. UI (optional, later phase)

A force-directed **story-map panel** — filterable by node kind and edge kind, click
a node to open the fragment. This is genuinely secondary: the core ask is "for the
librarian to better traverse," which is satisfied entirely by §5–§6 on the backend.
Any visualization must respect the house aesthetic in `.impeccable.md` (warm,
bookish, restrained — not a neon SaaS network diagram; `prefers-reduced-motion`
honored).

## 9. Phasing

1. **Graph core** — `schema` + `build` + `storage` + `rebuildStoryGraph` endpoint
   + tests. Pure projection from existing data. **No behavior change** — nothing
   consumes the graph yet, so it ships safely.
2. **Query layer** — `query.ts` algorithms (§5) + unit tests over hand-built
   graphs.
3. **Librarian tools + story-map block** — wire §6 tools and context block,
   update prompts, add `patchGraphForAnalysis` on `saveAnalysis`. This is where the
   librarian "traverses better."
4. **UI graph view** *(optional)* — visualization panel + `/graph/query` route.

## 10. Risks & decisions

- **Staleness vs. cost.** Incremental patch on `saveAnalysis` keeps the common path
  cheap; the rebuild endpoint covers drift. The watermark
  (`builtFromAnalysisUpdatedAt`) makes "is this graph current?" a cheap check.
- **Edge explosion.** `shares_tag` is capped; high-fanout tags are skipped or
  down-weighted so the graph stays walkable.
- **Branches.** Storing under `getContentRoot` means each branch has its own graph,
  consistent with every other per-story index. No cross-branch leakage.
- **Derived-node identity.** Thread/event node ids are derived deterministically
  from normalized text so repeated analyses converge instead of spawning
  duplicates (same normalization discipline as `normalizeUniqueLines`).
- **Custom fragment types.** Plugin/custom types still get nodes (generic kind), so
  the graph never silently drops user-defined content.

## 11. Out of scope for v1

- LLM-extracted semantic edges (causality, explicit character relationships,
  location membership). The structural graph is the foundation; a later "graph
  enrichment" pass could add these via the librarian, but it carries LLM cost and
  is deferred deliberately.
- Cross-story / series-level graphs.
- Graph-based generation context injection (using the graph to *select* what the
  writer sees) — promising, but a separate initiative once the graph is trusted.
