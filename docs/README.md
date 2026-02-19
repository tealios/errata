# Documentation Index

- `docs/fragments-and-prose-chain.md`
  - Fragment system and prose chain: complete schema reference, fragment types, ID conventions, prose chain structure, filesystem storage layout, full API reference, import/export format, SillyTavern character card import (PNG + JSON with lorebook/world book support), and porting guide.
- `docs/context-blocks.md`
  - Context block system: structured LLM prompt blocks, the `beforeBlocks` plugin hook, Block Editor UI, custom blocks (simple + script), and block configuration API.
- `docs/summarization-and-memory.md`
  - Technical reference for rolling story memory: deferred summary application, latest-analysis dedupe for reanalysis safety, structured summary signals, compaction thresholds, settings/API wiring, and test coverage.
- `docs/backend-stress-harness.md`
  - How to run the synthetic backend stress harness for summary/index scalability and context build latency benchmarking.
- `docs/third-party-plugins.md`
  - How to build external plugins, use runtime iframe UI, scaffold from templates, client-side panel hooks (`onPanelOpen`/`onPanelClose` for bundled, `postMessage` for iframe), query cache invalidation, and validate in dev.
- `docs/runtime-plugins-and-binary-packaging.md`
  - Runtime plugin loading, binary build/package workflow, CI release automation, and deployment notes.
- `docs/component-ids.md`
  - Frontend `data-component-id` contract for extensibility and automation.
- `docs/publishing-plugin-sdk.md`
  - How to publish `@tealios/errata-plugin-sdk` manually and via GitHub Actions.

Related:

- `plugins/templates/README.md`
  - Plugin recipe template catalog.
- `packages/errata-plugin-sdk/package.json`
  - Local SDK package: `@tealios/errata-plugin-sdk`.
- `PLAN.md`
  - Full architecture reference: schemas, project structure, API routes, data model, generation pipeline.
- `CLAUDE.md`
  - Development guide for Claude Code: commands, conventions, efficiency tips.
