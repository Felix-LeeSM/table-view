# Sprint 458 Contract: RDBMS Version Capability Gates

## Goal

Attach version-aware capability gates to RDBMS profiles so PostgreSQL, MySQL,
MariaDB, SQLite, and DuckDB can differ without scattered `dbType` checks.

## Dependencies

- Depends on: 441, 450, 452, 455.
- Parallel lane: rdbms/shared.
- Blocks: 459.

## Scope

- Define where server/file version metadata is captured.
- Add version-aware capability helpers for a small set of real differences.
- Keep unknown version behavior conservative.
- Add tests for representative RDBMS variants.

## Acceptance Criteria

- AC-458-01: Capability gates can depend on version metadata.
- AC-458-02: Unknown versions do not enable unsupported features optimistically.
- AC-458-03: Gates are reusable by connection, query, edit, and schema surfaces.
- AC-458-04: Existing behavior remains stable where version is unavailable.

## Out of Scope

- Full feature matrix for every DBMS version.
- Online documentation scraping.
- Automatic upgrade recommendations.

## Verification Plan

1. Capability helper tests.
2. Fixture/profile tests for known and unknown versions.
3. Typecheck.
