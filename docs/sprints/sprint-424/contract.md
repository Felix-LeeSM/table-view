# Sprint 424 Contract: MySQL/MariaDB Completion Closure

## Goal

Open the SQL WASM completion core for MySQL and MariaDB request dialects using
the shared SQL completion request/catalog shape.

## Acceptance Criteria

- AC-424-01: MySQL and MariaDB requests no longer return the v0 empty result.
- AC-424-02: MySQL-family keyword candidates include `SHOW`, `DESCRIBE`, `USE`,
  and `ON DUPLICATE KEY UPDATE`.
- AC-424-03: MySQL-family function candidates include existing MySQL profile
  functions such as `JSON_EXTRACT`.
- AC-424-04: mysql-client meta commands such as `\G` are emitted as
  `meta-command`, not SQL keywords.

## Validation

```bash
cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml completion
pnpm vitest run src/lib/sql/sqlDialectProfile.test.ts
```
