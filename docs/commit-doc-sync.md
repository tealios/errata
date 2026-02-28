# Commit-Driven Documentation Sync

Generated: 2026-02-28T00:00:00.000Z
Verified: 2026-02-28 (manual code review against git show)

## Baseline

- Baseline commit: `e83338cda2ae9a884c3b7d78c57dab41bb668057` (2026-02-18)
- Baseline reason: this is the latest point where accumulated doc changes cover at least 50% of tracked docs.
- Coverage at baseline: 54.2% (14/26 docs)

## Sync Range

- From (exclusive): `8ca78fdbcbd45d3ec64704be2cd20e54ed61ba37`
- To (inclusive): `1eaa9bcfcf52c6587bb35c2a5ef947511a29d314`
- Commits inspected: 40

## Commit Feed

### `d87d940` docs: add instruction registry and generation pipeline documentation
- Adds `docs/generation-pipeline.md` (two-phase prewriter/writer pipeline), `docs/instruction-registry.md` (centralized prompt management with model-specific overrides). Expands model resolution section in `docs/context-blocks.md` with fallback chain derivation, backward compatibility tables, namespace roles, and registered agents table. Updates `docs/README.md` index.
- **Doc impact**: Self-contained doc update.

### `4875ff6` refactor(agents): derive model resolution from agent names instead of modelRole
- Removes `modelRole` field from `AgentBlockDefinition` interface in `agent-block-registry.ts`. Removes `fallback` array from `ModelRoleDefinition` in `model-role-registry.ts`. Fallback chains now derived algorithmically by splitting dot-separated agent names and popping segments (e.g. `librarian.chat` -> `['librarian.chat', 'librarian', 'generation']`). Collapses per-agent model role registrations to 4 namespace-level roles (generation, librarian, character-chat, directions). Adds `OVERRIDE_KEY_ALIASES` in `client.ts` for backward compat with old camelCase `modelOverrides` keys. Extracts `ProviderSelect` to shared component and `model-role-helpers.ts` to shared module. Adds per-agent model selection UI to `AgentContextPanel`.
- **Doc impact**: `docs/context-blocks.md` — the model resolution section was already updated in the preceding `d87d940` commit to reflect the algorithmic fallback; the `AgentBlockDefinition` interface listing no longer shows `modelRole` which matches the code. No further update needed. `docs/adding-agents.md` — does not exist yet at this commit (created later in `3ed296e`), so no impact.

### `e9ae807` docs(readme): add prewriter, model selection, directions, and other new features
- Updates top-level `README.md` features list (prewriter, per-role model selection, instruction overrides, direction suggestions, agent context panel, script blocks, covers, selection transforms, wizard, help, custom CSS).
- **Doc impact**: Self-contained doc update (README only).

### `4812b8c` fix(prose): move SaveIndicator to module scope to prevent remounting
- Moves `SaveIndicator` out of component body in `ProseWritingPanel.tsx` to avoid remount flicker.
- **Doc impact**: None — UI bug fix.

### `3ed296e` feat(agents): add optimize-character agent, streaming runner factory, and block helpers
- Adds `librarian.optimize-character` agent for rewriting character sheets (`optimize-character.ts`). Introduces `createStreamingRunner()` factory in `create-streaming-runner.ts` (207 lines) encoding the 14-step streaming pipeline. Adds composable block helpers (`instructionsBlock`, `storyInfoBlock`, `recentProseBlock`, `stickyFragmentsBlock`, `allCharactersBlock`, `targetFragmentBlock`, `compactBlocks`) in `block-helpers.ts` (217 lines). Adds `buildBasePreviewContext()` for preview context assembly. Migrates refine, optimize-character, prose-transform, and character-chat runners to factory. Creates `docs/adding-agents.md` (769 lines) documenting the full agent creation workflow. Also adds character mention hover cards (`CharacterMentionSpan`, `CharacterPreviewCard`), `CharacterAvatar` extraction, dialogue emphasis stripping, sidebar rename "Block Editor" to "Agents", and `searchFragments` image/icon filtering.
- **Doc impact**: Self-contained — creates `docs/adding-agents.md` which already documents the factory pattern, block helpers, and agent creation workflow. `docs/character-chat.md` — character-chat runner migrated to factory, but the doc already describes it using `createToolAgent` and the block system, so the factory detail is a minor gap (the internal runner pattern is not central to the character-chat doc's purpose).

### `a76da72` refactor(agents): add createAgentInstance helper and simplify route handlers
- Adds `createAgentInstance()` in new file `agent-instance.ts` (161 lines). Replaces manual `invokeAgent` + `registerActiveAgent`/`unregisterActiveAgent` boilerplate with a typed helper that handles agent lifecycle, active registry tracking, and trace logging. Bumps default `maxSteps` from 5 to 10 in `create-streaming-runner.ts`. Adds `LibrarianPanel` component (38 lines) and `AgentActivityIndicator` component (7 lines). Simplifies route handlers in `character-chat.ts`, `generation.ts`, and `librarian.ts`.
- **Doc impact**: `docs/adding-agents.md` — the doc covers agent instantiation patterns; `createAgentInstance` is a new helper for route-level agent lifecycle that supplements the `createStreamingRunner` factory. The doc's manual pipeline reference (Step 3) does not use `createAgentInstance` since it operates at a different level (route handlers, not agent runners). Minor gap — the doc could mention `createAgentInstance` for route handler authors.

### `f612606` feat(fragments): add lock and frozen sections protection
- Adds fragment lock (`meta.locked`: boolean) to block all LLM tool writes. Adds frozen sections (`meta.frozenSections`: array of `{id, text}` objects) to preserve specific text spans through LLM updates using text-based matching. Enforces protection in LLM tools (`updateFragment`, `editFragment`, `deleteFragment`, `editProse`), librarian analysis tools, and auto-apply suggestions. Adds lock toggle and freeze-selection UI to `FragmentEditor` with split-textarea rendering. Creates `protection.ts` (77 lines) with `isFragmentLocked()`, `getFrozenSections()`, and related helpers. Also adds new-story block to context builder (shown when no prose exists) and prewriter. Includes 179 lines of protection tests.
- **Doc impact**: `docs/fragments-and-prose-chain.md` — new `locked` and `frozenSections` metadata fields on fragments; these are significant additions to the fragment data model. `docs/generation-pipeline.md` — new-story block added to context builder for empty stories; the default blocks table should include it.

### `306c575` perf(prose): eliminate cascading re-renders during streaming
- Extracts `StreamingSection` so stream chunks only re-render the streaming subtree. Extracts `ProviderQuickSwitch` to isolate query subscriptions. Ref-stabilizes `mentionColors` map. Wraps `ProseBlock`, `ChapterMarker`, `InsertChapterDivider` in `memo()`.
- **Doc impact**: None — performance optimization, internal component refactor.

### `ef3c03b` Merge pull request #10 from ivanlisovyi/perf/prose-render-optimization
- Merge of prose streaming performance PR.
- **Doc impact**: None.

### `77254ae` feat(covers): replace guilloche with procedural SVG cover generation
- Replaces Lissajous-based `GuillochePattern` with seeded SVG cover generator. Supports light/dark palettes, in-memory caching, deterministic output.
- **Doc impact**: None — UI/visual feature, no doc coverage area.

### `061f065` feat(folders): add fragment folder system with drag-and-drop
- Adds folder CRUD (create, rename, reorder, delete) stored in per-story `folders.json`. Fragment-to-folder assignments via centralized assignments map. Creates `folders.ts` storage (154 lines), API routes (71 lines), and client API (45 lines). `FragmentList` rewritten with collapsible folder sections, cross-folder drag-and-drop, inline rename, and color accents. Includes 215 lines of tests.
- **Doc impact**: `docs/fragments-and-prose-chain.md` — new folder system for organizing fragments; new storage file (`folders.json`) and API endpoints. Significant addition to fragment management not currently documented.

### `4ef02b0` feat(token-usage): add centralized token usage tracking
- Adds `token-tracker.ts` (254 lines) for per-agent and per-model token tracking, both in-memory (session) and persisted to disk. Instruments `create-streaming-runner.ts`, `suggest.ts` (directions), and `agent.ts` (librarian analysis). Adds usage breakdown UI in `StoryInfoPanel` with expandable per-agent and per-model views. Adds API route in `token-usage.ts` (23 lines) and client in `token-usage.ts` (27 lines).
- **Doc impact**: `docs/generation-pipeline.md` — token tracking is wired into generation paths; the generation log already documents `totalUsage` field. Could warrant its own doc section if it grows.

### `693d9d9` feat(prewriter): add pacing directions via suggestDirections tool
- Prewriter prompt updated to require calling a `suggestDirections` tool after writing the brief. The tool is defined inline in `prewriter.ts` (not the `directions.suggest` agent) and collects exactly 3 pacing-aware directions: linger (stay in moment), continue (advance scene), and end (resolve tension). Directions stream to client via a new `directions` event type and persist in generation logs via new `directions` field. `InlineGenerationInput` merges prewriter directions with analysis suggestions and adds edit-before-send.
- **Doc impact**: `docs/generation-pipeline.md` — prewriter now has a directions phase after the brief; the prewriter blocks/events section needs to document the `suggestDirections` tool and `directions` event type.

### `52902f8` feat(ui): add font size scaling, wizard preferences, and librarian protection
- Adds global UI font-size option (XS-XL) via root font-size scaling in `theme.tsx` (66 lines). Extends `StoryWizard` with generation mode and hierarchical summary preferences. Librarian analysis tools now respect locked/frozen fragment protection when suggesting updates, with 122 lines of new tests.
- **Doc impact**: `docs/summarization-and-memory.md` — librarian respects locked/frozen protection during analysis; worth noting in the fragment suggestions section.

### `45602eb` fix(ui): convert text-[px] to rem so UI size scaling works everywhere
- Replaces pixel-based `text-[Npx]` Tailwind classes with rem equivalents across component files.
- **Doc impact**: None — UI styling fix.

### `1813d37` perf(fonts): lazy-load Google Fonts to eliminate render-blocking request
- Replaces static `<link>` with dynamic font loader that reads preferences from localStorage. Adds `loadFullFontCatalogue()` utility for on-demand loading.
- **Doc impact**: None — performance optimization.

### `4acad0d` Merge pull request #11 from ivanlisovyi/perf/lazy-load-google-fonts
- Merge of lazy-load Google Fonts PR.
- **Doc impact**: None.

### `3954d31` feat(ui): add variation switcher buttons to prose action panel
- Adds variation switcher buttons (20 lines) to `ProseBlock.tsx` allowing switching between variants directly in the prose popup regardless of the quick switch setting.
- **Doc impact**: `docs/prose-writing-panel.md` — new variation switcher in prose action panel. Minor addition; the doc covers prose block actions.

### `42914a4` add token counting for other apis
- Adds `usage-normalizer.ts` (46 lines) to fix token counting for non-standard providers (specifically nano-gpt). Modifies `generation.ts` route to use the normalizer.
- **Doc impact**: None — bug fix for token counting on alternative providers.

### `530e219` deps: add @elysiajs/openapi for API documentation
- Adds `@elysiajs/openapi` dependency.
- **Doc impact**: None — dependency addition.

### `1d3ef63` art: redesign cover SVG with simplified teal/slate theme
- Redesigns the static `public/cover.svg` asset.
- **Doc impact**: None — art asset.

### `b234bda` feat(api): integrate OpenAPI plugin with tag documentation
- Wires `@elysiajs/openapi` into `src/server/api.ts` with tag-based route grouping.
- **Doc impact**: None — API infrastructure, no existing doc covers API schema.

### `ed4bbe8` feat(api): add OpenAPI tags and summaries to all route handlers
- Adds OpenAPI metadata (tags, summaries) to route handler files.
- **Doc impact**: None — API metadata annotations.

### `dfa5e4c` fix(ui): use stable section-based keys for prose chain rendering
- Fixes React key stability in `ProseChainView`.
- **Doc impact**: None — UI bug fix.

### `6d1ccc8` feat(ui): pass selected text to writing panel and use props for ask-librarian
- Replaces custom DOM event with React props for ask-librarian flow. Forwards text selection from prose view into writing panel editor via route-level state threading through `ProseBlock` -> `DetailPanel` -> `LibrarianPanel`.
- **Doc impact**: `docs/prose-writing-panel.md` — writing panel now receives selected text from prose view. Minor enhancement to data flow section.

### `80c118b` Merge pull request #13 from Tointer/token_counting_fix
- Merge of token counting fix PR.
- **Doc impact**: None.

### `491e796` feat(ui): unify view toggle and outline toggle into single toolbar
- Merges prose/chat view toggle and outline expand/collapse into one adaptive toolbar.
- **Doc impact**: None — UI layout change.

### `cb3182a` fix(import): warn on script block packs and clear type errors
- Adds import warnings for script block packs in `FragmentImportDialog`. Fixes various type errors across multiple files.
- **Doc impact**: None — bug fix and type cleanup.

### `9ff25f5` fix(ui): offset sidebar trigger in collapsed mode
- Fixes sidebar trigger positioning when sidebar is collapsed.
- **Doc impact**: None — UI bug fix.

### `1477066` feat(llm): expand fragment reference tags in LLM messages
- Adds `<@fragment-id>` and `<@fragment-id:short>` tag syntax in `context-builder.ts` (105 lines). Tags are expanded in compiled messages before reaching the LLM via `expandFragmentTags()`. Full tags (`<@ch-bafego>`) render via the fragment type registry's `renderContext()` method. Short tags (`<@ch-bafego:short>`) emit `{name}: {description}`. Unknown fragments render as `[unknown fragment: {id}]`. Supports optional depth-limited recursion with circular reference detection (`[circular fragment: {id}]`). Integrated at all `compileBlocks` call sites: generation, prewriter, agent context, and block/agent-block previews. Includes 373 lines of tests.
- **Doc impact**: `docs/context-blocks.md` — fragment reference tags are a new feature of the block compilation pipeline; `compileBlocks` and compilation section should document the tag expansion step. `docs/fragments-and-prose-chain.md` — fragments can now be referenced inline via `<@id>` tags in block content and custom blocks.

### `06613ba` refactor(storage): extract writeJsonAtomic to shared fs-utils
- Moves atomic write-via-rename pattern into shared `src/server/fs-utils.ts` (7 lines). Adopted across 11 JSON storage modules.
- **Doc impact**: None — internal infrastructure refactor.

### `312425e` feat(librarian): add multi-conversation support
- Adds conversation CRUD to librarian storage (140 lines added): list, create, delete, per-conversation chat history. Adds REST endpoints (79 lines) and API client methods (17 lines). Conversations auto-title from first user message. Includes `generateConversationId()` for `cv`-prefixed IDs. Conversations are indexed separately from the legacy single-chat history.
- **Doc impact**: `docs/summarization-and-memory.md` — librarian now supports multiple conversations; the doc's current description implies a single chat context. New API endpoints and storage layout need documenting.

### `d5eba3c` feat(ui): conversation-based librarian chat and agent panel restructure
- Reworks librarian panel to use multi-conversation chat: conversation list with create/delete, per-conversation history, and back navigation. Removes legacy single-chat clear button and activity tab. Creates `AgentsPanel` (42 lines) with activity + context tabs, and `AgentActivityPanel` (489 lines) replacing old agent-context sidebar section. Threads `askLibrarianPrefill` through prose block -> detail panel -> librarian panel.
- **Doc impact**: `docs/summarization-and-memory.md` — librarian UI is now conversation-based; the doc should reflect multi-conversation UX. `docs/adding-agents.md` — new `AgentsPanel` component replaces old sidebar agent-context section; the doc references `AgentContextPanel.tsx` in its file reference table which is still accurate at this point (rename happens later in `bec4821`).

### `9853dd2` feat(ui): virtualize prose chain and rework prose action panel
- Adds `@tanstack/react-virtual` for prose chain virtualization (activates for >10 items). Reworks `ProseBlock` action panel into compact floating toolbar positioned near click point. Removes refine mode from prose action panel UI (refine flow moved to ask-librarian), merging its functionality into regenerate. Consolidates scroll tracking to use virtualizer `onChange` when virtualized, `IntersectionObserver` otherwise.
- **Doc impact**: `docs/generation-pipeline.md` — refine mode still documented as a generation mode; the backend API still supports it but the primary UI entry point has been removed. Worth noting the UI change. `docs/prose-writing-panel.md` — prose action panel redesigned to floating toolbar; the doc's current description of prose block actions may need updating.

### `30bb753` chore(assets): replace cover.svg with ErrataLogo.png
- Replaces `cover.svg` with `ErrataLogo.png`.
- **Doc impact**: None — asset swap.

### `9104d76` Merge branch 'master' of https://github.com/tealios/errata
- Merge commit.
- **Doc impact**: None.

### `d05d732` feat(ui): reorder agent tabs, expand model settings, and add temperature control
- Swaps Context and Activity tabs in `AgentsPanel` (Context as default tab). Expands model section by default. Exposes per-agent temperature input in `AgentContextPanel`. Changes limited to `AgentContextPanel.tsx` (23 lines added) and `AgentsPanel.tsx` (10 lines changed).
- **Doc impact**: None — UI layout changes to agent panel. The temperature input is a UI-only addition here; the backend wiring comes in `319ffbd`.

### `319ffbd` feat: add per-agent and per-provider temperature support
- Wires temperature through the full stack across 19 files. Provider config schema (`config/schema.ts`) gains `temperature` field. Model resolution in `client.ts` (30 lines added) walks the fallback chain for temperature: first checks the matched role override's `temperature`, then walks the chain for any role with temperature set, then falls back to provider-level `temperature`. `ResolvedModel` interface gains `temperature?: number` field. `create-agent.ts` and `create-streaming-runner.ts` pass resolved temperature to agent creation. Writer agent (`writer-agent.ts`) and prewriter (`prewriter.ts`) use resolved temperature. Story settings schema gains temperature in model overrides. All UI surfaces updated: `ProviderManager`, `SettingsPanel`, story overrides.
- **Doc impact**: `docs/generation-pipeline.md` — temperature is now configurable per-agent and per-provider with fallback chain; affects model resolution and agent creation. `docs/context-blocks.md` — model resolution section should document temperature resolution alongside provider/model resolution.

### `bec4821` refactor(ui): redesign agent panel — rename Context to Configure, clean up layout
- Renames file `AgentContextPanel.tsx` to `AgentConfigurePanel.tsx` (599 lines rewritten). Renames tab label "Context" to "Configure" with `SlidersHorizontal` icon in `AgentsPanel.tsx`. Model settings always visible (no collapsible). Temperature inherit hint shown inline. Adds `resolveInheritedTemperature` helper in `model-role-helpers.ts` (30 lines) for temperature fallback chain resolution.
- **Doc impact**: `docs/context-blocks.md` — file reference table lists `AgentContextPanel.tsx` which is now `AgentConfigurePanel.tsx`. Text references "Agent Context panel" which is now "Agent Configure panel". `docs/adding-agents.md` — references `AgentContextPanel.tsx` in file reference and "Agent Context panel" in text; both renamed.

### `1eaa9bc` feat(prose): add manual Compose mode to inline generation input
- Adds a third "Compose" tab alongside Freeform/Guided in `InlineGenerationInput` (128 lines changed). Lets users write prose directly and add it as a new prose chain section without LLM generation. Creates a prose fragment with `meta.generationMode: 'manual'`. Input mode type expanded from `'freeform' | 'guided'` to `'freeform' | 'guided' | 'compose'`. Mode preference persisted in `localStorage`.
- **Doc impact**: `docs/prose-writing-panel.md` — new Compose mode is a third generation input mode alongside Freeform and Guided; the doc's "Guided Mode" section should be expanded to cover all three modes. `docs/fragments-and-prose-chain.md` — new `generationMode: 'manual'` metadata value on prose fragments created via Compose.
