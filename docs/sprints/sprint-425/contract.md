# Sprint 425 Contract: SQLite Completion And Shell

## Goal

Open the SQL WASM completion core for SQLite and expose sqlite-cli meta
commands through the shell layer.

## Acceptance Criteria

- AC-425-01: SQLite requests return keyword/function/catalog candidates through
  the same core path as PostgreSQL/MySQL.
- AC-425-02: SQLite keyword candidates include `PRAGMA` and `WITHOUT ROWID`.
- AC-425-03: sqlite-cli meta commands such as `.schema` are emitted as
  `meta-command`, not SQL keywords.
- AC-425-04: Dot-command replace ranges include the leading `.`.

## Validation

```bash
cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml completion
pnpm build:sql-wasm
```
