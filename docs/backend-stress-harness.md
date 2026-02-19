# Backend Stress Harness

This harness builds synthetic long-story fixtures and benchmarks summary/context paths for backend scalability work.

Command:

```bash
bun run stress:backend
```

Optional flags:

- `--prose=<n>` prose fragment count (default `2000`)
- `--nonProse=<n>` character/guideline/knowledge fragment count (default `500`)
- `--reanalysisRatio=<0..1>` fraction of prose fragments that receive a second analysis (default `0.1`)
- `--chapterEvery=<n>` chapter marker interval (default `50`)
- `--runs=<n>` benchmark iterations per metric (default `20`)
- `--warmups=<n>` warmup iterations per metric (default `3`)
- `--compactType=proseLimit|maxTokens|maxCharacters` context compact mode (default `proseLimit`)
- `--compactValue=<n>` compact value for the selected mode (default `10`)
- `--targetOffset=<n>` regenerate target distance from end of prose chain (default `5`)

Example quick run:

```bash
bun run stress:backend --prose=300 --nonProse=120 --runs=8 --warmups=1
```

What it measures:

- `summaryBefore (legacy scan)`: rebuild summary by scanning all analyses + dedupe
- `summaryBefore (index)`: rebuild summary from `librarian/index.json` lookups
- `buildContextState (normal)`: standard context assembly
- `buildContextState (regenerate path)`: `summaryBeforeFragmentId` + `proseBeforeFragmentId`

Output includes:

- p50/p95/mean/min/max per metric
- summary parity check (`legacy` vs `index` output must match)
- index speedup ratio (legacy mean / index mean)
- JSON report block (`JSON_REPORT_START ... JSON_REPORT_END`) for automated parsing

Notes:

- The harness uses a temp data directory and removes it on completion.
- Data is synthetic and does not call external LLM providers.
- This is intended to validate summary/index path performance and correctness under large analysis counts.
