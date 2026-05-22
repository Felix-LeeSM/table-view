---
review-profile: code
---

# Sprint 455 Contract: DuckDB Connection And File Contract

## Goal

Introduce DuckDB as the RDBMS/file-analytics successor to SQLite file-source
work without adding a new paradigm prematurely.

## Dependencies

- Depends on: 452.
- Parallel lane: rdbms/duckdb.
- Can run after SQLite connection contract is stable.

## Scope

- Define DuckDB profile, file connection fields, read-only behavior, and privacy
  constraints for local files.
- Decide supported file inputs for the first slice: `.duckdb` first, analytics
  files later.
- Define local fixture strategy.
- Add tests for profile and connection metadata.

## Acceptance Criteria

- AC-455-01: DuckDB is modeled as RDBMS + file connection kind.
- AC-455-02: File analytics does not bypass local-first privacy policy.
- AC-455-03: `.duckdb` connection behavior is defined before CSV/Parquet/JSON.
- AC-455-04: SQLite file-source logic can be reused without identity confusion.

## Out of Scope

- Query execution.
- CSV/Parquet/JSON import.
- Cloud/object-store access.

## Verification Plan

1. Profile/connection tests.
2. Fixture strategy smoke.
3. Docs check.

## Evidence

- DuckDB connection and fixture strategy: `duckdb-connection-contract.md`.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
