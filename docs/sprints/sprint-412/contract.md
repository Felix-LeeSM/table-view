# sprint-412 — WASM size budget governance

## Scope

Add an enforced gzip-size budget for the checked-in SQL and Mongo parser WASM
artifacts. Make the budget visible in CI, npm scripts, sprint contract policy,
and README developer workflow.

## WASM Budget

| Artifact | Path | Budget | Current measured gzip |
| --- | --- | --- | --- |
| SQL parser | `src/lib/sql/wasm/sql_parser_core_bg.wasm` | 80 KiB / 81,920 bytes | 64,124 bytes |
| Mongo parser | `src/lib/mongo/wasm/mongosh_parser_core_bg.wasm` | 50 KiB / 51,200 bytes | 50,595 bytes |

Validation command: `pnpm wasm:size`.

## Acceptance Criteria

- AC-412-01: `scripts/check-wasm-size.sh` fails when SQL or Mongo parser WASM
  gzip size exceeds its budget.
- AC-412-02: `package.json` exposes `pnpm wasm:size`.
- AC-412-03: PR CI runs the WASM size budget check.
- AC-412-04: sprint documentation policy requires future parser/WASM contracts
  to include a `WASM budget` section.
- AC-412-05: README documents the local command and enforced budgets.

## Non-Goals

- Do not regenerate WASM artifacts in this sprint.
- Do not optimize parser size or change parser behavior.
- Do not introduce a new build tool or runtime dependency.
