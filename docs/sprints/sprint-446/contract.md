# Sprint 446 Contract: Connection Kind Compatibility

## Goal

Represent existing connection forms through profile connection-kind metadata
without changing the connection dialog behavior.

## Dependencies

- Depends on: 441.
- Parallel lane: connection UI/profile.
- Can run with: 442, 443, 444, 445.

## Scope

- Map PostgreSQL/MySQL/MariaDB/MongoDB to `server`.
- Map SQLite user DBMS work to `file` or transitional file metadata while
  preserving current app-state SQLite boundaries.
- Keep current fields, defaults, validation, and persistence behavior.
- Add tests for connection-kind defaults and field visibility.

## Acceptance Criteria

- AC-446-01: Existing connection workflows render the same fields.
- AC-446-02: Connection-kind metadata is available for future DuckDB/SQLite work.
- AC-446-03: SQLite user DBMS metadata is not confused with internal app state.
- AC-446-04: Unknown connection kind cannot silently enable a broken form.

## Out of Scope

- New file picker implementation.
- Credential/keyring migration.
- New DBMS connection support.

## Verification Plan

1. Connection profile tests.
2. Focused connection UI tests.
3. Typecheck.
