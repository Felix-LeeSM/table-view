---
review-profile: code
---

# Sprint 449 Contract: MySQL-Family Scripting Boundary

## Goal

Define and implement the smallest safe boundary for MySQL-family client
scripting features without pretending full MySQL CLI compatibility exists.

## Dependencies

- Depends on: 448.
- Parallel lane: rdbms/mysql.
- Blocks: 459.

## Scope

- Decide whether `DELIMITER` is rejected, normalized, or handled by a bounded
  pre-parser.
- Decide the first `LOAD DATA` support level: unsupported, warning-only, or
  narrow explicit-confirmation path.
- Keep documentation and runtime messaging aligned.
- Add tests around multi-statement splitting and unsafe scripting rejection.

## Acceptance Criteria

- AC-449-01: `DELIMITER` behavior is explicit and tested.
- AC-449-02: `LOAD DATA` behavior is explicit and tested.
- AC-449-03: Unsupported scripting does not silently execute as ordinary SQL.
- AC-449-04: The support matrix no longer contains ambiguous MySQL scripting
  language.

## Out of Scope

- Full procedure body parser.
- Full MySQL CLI emulation.
- Data import UX beyond the selected boundary.

## Verification Plan

1. Parser/splitter tests.
2. Safe Mode tests.
3. Affected frontend query execution tests.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
