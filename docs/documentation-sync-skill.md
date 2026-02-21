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
6. Updates the in-app help component (`src/components/help/help-content.tsx`) when user-facing features change.

## Run

```bash
bun run docs:sync
```

## Tracked documentation

- **Markdown docs** — Files in `docs/` and root-level `.md` files.
- **Help component** — `src/components/help/help-content.tsx` contains the in-app help panel content. When features are added or changed, the corresponding help section/subsection should be updated to match. The help is structured as `HELP_SECTIONS` — an array of `HelpSection` objects each containing `subsections` with JSX content.

## Baseline behavior

- First run: baseline is computed from docs history.
- Later runs: baseline is frozen in `.agent/docs-sync-state.json` and sync proceeds incrementally from the last processed commit.

## Reset baseline

Delete `.agent/docs-sync-state.json` and run again.
