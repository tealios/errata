# Frontend Stress Test: 200k Word Story

Analysis of frontend performance issues that arise with a long-running story (~200k words, ~500 prose entries, hundreds of fragments).

---

## 1. ProseChainView — No Virtualization

**File:** `src/components/prose/ProseChainView.tsx`

The main prose view renders every single item in a flat `.map()` with no windowing or virtualization:

```tsx
// Line 333-367
orderedItems.map((fragment, idx) => (
  <ReactFragment key={fragment.id}>
    {idx === 0 && <InsertChapterDivider storyId={storyId} position={0} />}
    {fragment.type === 'marker' ? (
      <ChapterMarker ... />
    ) : (
      <ProseBlock ... />
    )}
    <InsertChapterDivider storyId={storyId} position={idx + 1} />
  </ReactFragment>
))
```

With 500 entries, this mounts **500 ProseBlock/ChapterMarker components + 501 InsertChapterDivider components** into the DOM simultaneously. The only scroll mechanism is a Radix `ScrollArea` (native scroll with custom scrollbar styling) — no lazy rendering.

### Data fetching on mount

ProseChainView fires four parallel queries on every story load:

```tsx
// Line 87-106
const { data: proseChain } = useQuery({
  queryKey: ['proseChain', storyId],
  queryFn: () => api.proseChain.get(storyId),         // ALL entries + ALL variations
})
const { data: fragments = [] } = useQuery({
  queryKey: ['fragments', storyId, 'prose'],
  queryFn: () => api.fragments.list(storyId, 'prose'), // ALL prose fragments (full objects)
})
const { data: markerFragments = [] } = useQuery({
  queryKey: ['fragments', storyId, 'marker'],
  queryFn: () => api.fragments.list(storyId, 'marker'), // ALL markers
})
const { data: characterFragments = [] } = useQuery({
  queryKey: ['fragments', storyId, 'character'],
  queryFn: () => api.fragments.list(storyId, 'character'), // ALL characters (if mentions on)
  enabled: mentionsEnabled,
})
```

The prose chain GET endpoint (`GET /api/stories/:storyId/prose-chain`) loads every fragment for every variation in every entry on the backend — individual `getFragment()` file reads. With 500 entries averaging 3 variations, that's ~1,500 file system reads per page load.

The `fragments?type=prose` query loads all prose fragments again (separately from the chain), including full `content` fields. This is redundant data for the purpose of building `allFragmentsMap`.

### Intersection observer on all blocks

```tsx
// Line 263-282
const observer = new IntersectionObserver(
  (entries) => { ... },
  { root: viewport, rootMargin: '-40% 0px -40% 0px', threshold: 0 },
)
const blocks = viewport.querySelectorAll('[data-prose-index]')
blocks.forEach((el) => observer.observe(el))
```

Observes every `[data-prose-index]` element for active-index tracking. At 500 blocks, the browser is tracking 500 intersection targets.

### Scroll position persistence

```tsx
// Line 183-217
viewport.addEventListener('scroll', handleScroll, { passive: true })
// Debounced to 150ms, writes to sessionStorage
sessionStorage.setItem(SCROLL_POS_KEY, String(viewport.scrollTop))
```

Lightweight per-scroll handler, but fires on every scroll event across the full 500-block document height.

---

## 2. ProseBlock — Heavy Per-Instance Cost

**File:** `src/components/prose/ProseBlock.tsx` (~792 lines)

Each ProseBlock instance carries significant state and query overhead:

### State per block

- **10 `useState` hooks**: showActions, actionMode, actionInput, editingPrompt, editedPrompt, streamedActionText, isStreamingAction, thoughtSteps, actionFollowGeneration, isQuickSwitching
- **4 `useRef` hooks**: actionInputRef, textareaRef, streamRafRef, observerRef
- **4 `useMutation` hooks**: update, revert, switchVariation, deleteSection

### Queries per block

```tsx
// Each ProseBlock independently queries:
const { data: story } = useQuery({ queryKey: ['story', storyId], ... })
const { data: globalConfig } = useQuery({ queryKey: ['global-config'], ... })
```

With 500 blocks, that's 1,000 query cache lookups per render cycle. TanStack Query deduplicates the actual network requests, but each block still subscribes to the cache and re-renders on invalidation.

### DOM output per block

Each block renders:
1. **Header section** — user prompt description with accent bar, optional inline editing, model quick-switch dropdown, variation counter badge
2. **Content area** — `StreamMarkdown` component (full markdown parse), optional `GenerationThoughts`, text transform for mention color annotations
3. **Chevron rails** — two `ChevronRail` components for variation switching (conditional on `quickSwitch` setting)
4. **Action panel** — sticky bottom bar with 6-8 buttons (Edit, Regenerate, Refine, Ask, Split, Details, Delete), inline textarea for action input, provider/model selector

Estimated **30-50 DOM nodes per block** when the action panel is collapsed, **80-100** when expanded.

### Mention annotation processing

```tsx
// Per-block, when mentions are enabled:
buildAnnotationHighlighter(annotations)
```

Builds a text transform function that scans prose content for character name mentions and wraps them in colored spans. Applied recursively through all text nodes in the markdown output. Cost scales with content length × number of characters.

---

## 3. StreamMarkdown — Per-Block Markdown Parse

**File:** `src/components/ui/stream-markdown.tsx`

Dual-mode rendering:

- **During streaming** (`streaming=true`): Cheap — splits on double-newlines, renders plain `<p>` tags. No markdown parsing.
- **After streaming** (`streaming=false`): Full `react-markdown` parse per block. With 500 blocks mounted, all 500 get the full parse on initial render.

The component is `React.memo`'d — only re-renders when `content`, `streaming`, `variant`, or `textTransform` changes. But the initial mount cost is the full parse.

If `textTransform` is provided (for mention highlighting), it recursively walks all React children to apply transforms. Cost: O(content length × child depth).

---

## 4. ProseOutlinePanel — Renders All Items Twice

**File:** `src/components/prose/ProseOutlinePanel.tsx` (~285 lines)

The outline panel has two views, and both render all fragments:

### Expanded view (scrollable list)

```tsx
// Line 124
fragments.map((fragment, idx) => (
  // Button + 3 text spans + conditional marker styling
))
```

Each item: number label, description (truncated to 50 chars), content preview (60 chars), active highlight styling. ~6 DOM elements per item.

### Collapsed rail view (dot indicators)

```tsx
// Line 216
fragments.map((fragment, idx) => (
  <Tooltip>
    <TooltipTrigger>
      // Dot or horizontal bar for markers
    </TooltipTrigger>
    <TooltipContent>
      // Numbered tooltip
    </TooltipContent>
  </Tooltip>
))
```

Every item gets a `Tooltip` wrapper with trigger and content — even when collapsed. 500 fragments = 500 tooltip components in the rail, each with event listeners for hover.

Neither view is virtualized. The expanded view is in a `ScrollArea` but renders all items.

---

## 5. ChapterMarker — Lightweight but Adds Up

**File:** `src/components/prose/ChapterMarker.tsx` (~180 lines)

Per marker:
- Horizontal rule with centered badge (left/right CSS gradients)
- `contentEditable` span for inline title editing
- 4 action buttons (Edit, Summarize, Toggle Summary, Delete)
- Collapsible summary section
- 3 `useState` hooks, 2 `useMutation` hooks

Individually cheap. At 20-30 chapter markers in a long story, negligible compared to ProseBlock count.

---

## 6. InsertChapterDivider — 501 Invisible Hover Zones

**File:** `src/components/prose/ProseChainView.tsx` (lines 23-55)

```tsx
function InsertChapterDivider({ storyId, position }) {
  const queryClient = useQueryClient()
  const createMutation = useMutation({ ... })

  return (
    <div className="group/insert relative h-3 -my-1 flex items-center justify-center">
      <button ... />
    </div>
  )
}
```

Each one creates a `useMutation` hook and a `useQueryClient` call. With N+1 dividers for N items: 501 mutation instances, 501 query client subscriptions. The dividers are invisible (opacity-0) until hovered, but they're fully mounted in the DOM and their hooks are active.

---

## 7. FragmentList Sidebar — No Virtualization

**File:** `src/components/fragments/FragmentList.tsx`

The sidebar fragment list renders all non-prose fragments (characters, guidelines, knowledge, etc.) with:

- `useMemo` filtering by search term, sort mode, allowed types
- Full SVG bubble visual per fragment (deterministic shape generation from fragment ID)
- Name, description, ID display with truncation
- 3-5 badge components per item (pinned, system, type)
- Pin toggle button (hover-visible)
- Drag handle

No virtualization — a story with 200 non-prose fragments renders all 200 simultaneously. Each item includes an SVG generation call (`generateBubbles()`) that's not separately memoized.

---

## 8. Frontend API Client — No Pagination

**File:** `src/lib/api/prose-chain.ts`, `src/lib/api/fragments.ts`

```ts
// prose-chain.ts
get: (storyId) => apiFetch<ProseChain>(`/stories/${storyId}/prose-chain`)

// fragments.ts
list: (storyId, type?) => apiFetch<Fragment[]>(`/stories/${storyId}/fragments?type=${type}`)
```

No pagination parameters. No cursor support. No limit/offset. Every call returns the complete dataset. The backend endpoints mirror this — no pagination either.

---

## Summary: What Breaks and When

| Component | ~100 entries | ~300 entries | ~500 entries |
|---|---|---|---|
| **ProseChainView render** | Noticeable delay (~1s) | Sluggish (~3-5s initial) | Painful (5-10s, possible frame drops) |
| **ProseBlock × N** | 100 blocks, 200 query subs | 300 blocks, 600 query subs | 500 blocks, 1000 query subs |
| **DOM node count** | ~5,000 nodes | ~15,000 nodes | ~25,000+ nodes |
| **Prose chain GET** | ~300 file reads | ~900 file reads | ~1,500 file reads |
| **IntersectionObserver targets** | 100 | 300 | 500 |
| **InsertChapterDivider instances** | 101 mutations | 301 mutations | 501 mutations |
| **ProseOutlinePanel items** | 100 tooltips (rail) | 300 tooltips | 500 tooltips |
| **Fragment list sidebar** | Fine | Slow with 200+ items | Needs windowing |
| **StreamMarkdown parses** | 100 markdown parses | 300 parses | 500 simultaneous parses |
| **Memory** | ~50-100MB | ~200-300MB | ~400MB+ (content in React state) |

### First symptoms (user-visible)

1. **Initial page load freeze** — all ProseBlocks mount and parse markdown simultaneously
2. **Scroll jank** — 25,000+ DOM nodes, 500 intersection observer targets, no virtualization
3. **Slow query invalidation** — after generation, 1000+ query subscriptions re-evaluate
4. **Memory pressure** — every prose fragment's full content held in React state (fragments query + chain query = duplicate content in memory)

### Root causes

1. No list virtualization anywhere (ProseChainView, ProseOutlinePanel, FragmentList)
2. Every ProseBlock is a heavyweight component with independent state/queries
3. Prose chain GET endpoint does O(entries × variations) file reads
4. Fragment list endpoints return complete datasets with no pagination
5. Redundant data loading (chain + separate fragment list both carry full content)
