---
review-profile: code
---

# Sprint 453 Contract: SQLite Browse And Query Adapter

## Goal

Add the first user-facing SQLite DBMS adapter slice: connect, browse schema, and
run read/query workflows through the RDBMS surface.

## Dependencies

- Depends on: 452.
- Parallel lane: rdbms/sqlite.
- Blocks: 454 and 459.

## Scope

- Implement or wire SQLite adapter methods required for connect, catalog browse,
  and query execution.
- Use the SQLite file contract from sprint 452.
- Preserve app-state SQLite isolation.
- Add fixture-backed tests for tables, views, columns, indexes, and basic query.

## Acceptance Criteria

- AC-453-01: A user SQLite file can be opened as a DBMS source.
- AC-453-02: Catalog browse works for common SQLite objects.
- AC-453-03: Query execution returns a tabular result envelope.
- AC-453-04: Internal app database files are not accidentally listed or mutated.

## Out of Scope

- Row edit parity.
- Migration/rebuild helpers.
- DuckDB support.

## Verification Plan

1. SQLite fixture adapter tests.
2. Focused frontend connection/catalog/query tests.
3. Typecheck and cargo tests for touched crates.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
