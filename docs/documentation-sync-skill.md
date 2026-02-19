# Documentation Sync Skill

This skill keeps project documentation in sync with git commits.

## What it does

1. Detects a baseline commit by scanning markdown history from newest to oldest until at least 50% of tracked docs have been touched.
2. Uses that baseline as the starting point for incremental sync.
3. Reads commits from the last processed commit to `HEAD`.
4. Builds `docs/commit-doc-sync.md` with:
   - baseline details,
   - commit feed,
   - suggested docs to review when code changed without doc updates.
5. Stores state in `.agent/docs-sync-state.json`.

## Run

```bash
bun run docs:sync
```

## Baseline behavior

- First run: baseline is computed from docs history.
- Later runs: baseline is frozen in `.agent/docs-sync-state.json` and sync proceeds incrementally from the last processed commit.

## Reset baseline

Delete `.agent/docs-sync-state.json` and run again.
