# Commit-Driven Documentation Sync

Generated: 2026-02-22T00:00:00.000Z

## Baseline

- Baseline commit: `e83338cda2ae9a884c3b7d78c57dab41bb668057` (2026-02-18)
- Baseline reason: this is the latest point where accumulated doc changes cover at least 50% of tracked docs.
- Coverage at baseline: 54.2% (14/26 docs)

## Sync Range

- From (exclusive): `80d4a636948ba956b83910d1b3652bd4249476a2`
- To (inclusive): `8ca78fdbcbd45d3ec64704be2cd20e54ed61ba37`
- Commits inspected: 13

## Commit Feed

### `8a5d2ce` build: add devcontainer
- Adds `.devcontainer/` config for Codespaces/VS Code dev containers.
- **Doc impact**: None — infrastructure only.

### `231a196` ci: add workflow to run unit tests
- Adds `.github/workflows/test.yaml` for CI test runs.
- **Doc impact**: None — CI configuration.

### `edbe35b` ci: fix junit reporter name
- Fixes vitest JUnit reporter configuration.
- **Doc impact**: None.

### `7a45c26` ci: be consistent about vitest capitalization
- Minor CI config fix.
- **Doc impact**: None.

### `496e117` ci: hide logs for passing tests
- CI reporter tweak.
- **Doc impact**: None.

### `b39c424` Merge pull request #8 from keturn/build/devcontainer
- Merge of devcontainer PR.
- **Doc impact**: None.

### `3510165` Merge pull request #9 from keturn/ci/vitest
- Merge of CI vitest PR.
- **Doc impact**: None.

### `3d4311f` docs: sync documentation for script context helpers and fragment suggestions
- Updated `docs/context-blocks.md` (script context helpers), `docs/summarization-and-memory.md` (fragment suggestions), `docs/documentation-sync-skill.md`.
- **Doc impact**: Self-contained doc update.

### `f98c3d5` Merge branch 'master'
- Merge commit.
- **Doc impact**: None.

### `08a9bdf` feat(prewriter): add two-phase generation pipeline with prewriter agent
- Adds `src/server/llm/prewriter.ts` — prewriter agent that produces writing briefs.
- Adds prewriter toggle in story settings, prewriter event streaming, writer-brief context assembly.
- New files: `prewriter.ts`, updates to `generation.ts` route, `context-builder.ts`, settings schema.
- **Doc impact**: `docs/context-blocks.md` — registered agents table now includes `generation.writer` and `generation.prewriter`. ✅ Updated in this sync.

### `f9ef5fd` fix(prewriter): forward custom blocks and guidelines to writer agent
- Ensures prewriter's custom blocks and sticky guidelines are forwarded to the writer agent context.
- **Doc impact**: None — bug fix within existing system.

### `029194d` feat(prewriter): enable multi-step tool use and consolidate block editor
- Prewriter can now use tools (multi-step). Agent block editor shows prewriter alongside other agents.
- Registers `generation.writer` and `generation.prewriter` in the agent block registry.
- **Doc impact**: `docs/context-blocks.md` — agent table updated. ✅ Updated in this sync.

### `522d7ad` feat(instructions): add instruction registry with model-specific overrides
- Adds `src/server/instructions/` — instruction registry for model-aware prompt templates.
- Allows per-model instruction overrides (e.g., different system prompts for different model families).
- **Doc impact**: New subsystem. Consider dedicated doc if it grows. Currently internal.

### `8ca78fd` feat(agents): add modelRole field to agent block definitions
- Adds `modelRole` to `AgentBlockDefinition` for mapping agents to model roles.
- **Doc impact**: Note — this field was subsequently **removed** in the name-based model resolution refactor (not yet committed). `docs/context-blocks.md` `AgentBlockDefinition` interface remains correct (no `modelRole`).

