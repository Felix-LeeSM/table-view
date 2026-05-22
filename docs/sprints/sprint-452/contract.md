---
review-profile: code
---

# Sprint 452 Contract: SQLite DBMS Connection Contract

## Goal

Separate user-managed SQLite database support from internal app SQLite state and
lock the file-source connection contract.

## Dependencies

- Depends on: 447.
- Parallel lane: rdbms/sqlite.
- Can run with: 448 and 450 after 447.

## Scope

- Define SQLite user DBMS profile, file connection fields, read-only mode, and
  permission expectations.
- Ensure internal app state storage is not exposed as a user connection target.
- Define fixture strategy for local SQLite files.
- Add tests for profile/connection contract.

## Acceptance Criteria

- AC-452-01: User SQLite DBMS and internal app SQLite are explicitly separated.
- AC-452-02: File path, read-only flag, and validation behavior are defined.
- AC-452-03: Contract supports future DuckDB reuse without coupling the two.
- AC-452-04: No row-edit behavior is promised yet.

## Out of Scope

- Full SQLite query adapter.
- File picker UX polish.
- SQLite write parity.

## Verification Plan

1. Profile and connection contract tests.
2. Fixture creation smoke.
3. Documentation review.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
