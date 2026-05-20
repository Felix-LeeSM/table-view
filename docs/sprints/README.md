# Sprint Artifacts

Harness sprint outputs live here.

Prompts/templates stay in `.claude/skills/harness/`; run artifacts go in `docs/sprints/sprint-N/`.

## Policy

- Use project-wide `sprint-N` numbers.
- If `N` is unspecified, use the next unused number.

## Files

Common files: `spec.md`, `contract.md`, `execution-brief.md`, `findings.md`, `handoff.md`.

## WASM Budget

Any sprint that changes `src-tauri/sql-parser-core/`,
`src-tauri/mongosh-parser-core/`, or the generated `src/lib/**/wasm/`
artifacts must include a `WASM budget` section in `contract.md`. The section
records the gzip byte budget, the measured gzip size after regeneration, and
the validation command (`pnpm wasm:size`). Current enforced budgets are SQL
parser WASM ≤ 80 KiB gzip and Mongo parser WASM ≤ 50 KiB gzip.
