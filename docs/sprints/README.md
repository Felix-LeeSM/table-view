# Sprint Artifacts

Harness sprint outputs live here.

Prompts/templates stay in `.agents/skills/harness/`; run artifacts go in `docs/sprints/sprint-N/`.

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
the validation command (`bash scripts/check-wasm-size.sh`). Current enforced
budgets are SQL parser WASM ≤ 200 KiB gzip (204800 bytes) and Mongo parser WASM
≤ 53 KiB gzip (54272 bytes). `pnpm wasm:size` may remain a local convenience,
but sprint Required Checks should use the script command accepted by the review
runner.
