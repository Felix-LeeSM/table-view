# Sprint 420 Contract — Completion Architecture Boundary

## Goal

Document and start the ADR 0045 migration: keep current CodeMirror/TS
completion running, but introduce the stable request/result boundary that a
future Rust/WASM completion core will consume.

Phase source: [`docs/archives/phases/completed/phase-31.md`](../../archives/phases/completed/phase-31.md).

## Plan

1. Contract first:
   - Define cursor offsets as UTF-16 + UTF-8 byte offsets.
   - Define generic completion item/result shapes.
   - Keep request shape multi-dialect from day one.
2. SQL adapter first:
   - Build a SQL completion request from the normalized catalog context.
   - Include `dialect`, `family`, `shell`, `serverVersion`, `capabilities`,
     `defaultSchema`, `searchPath`, `catalog`, and cache state.
   - Do not add hot-path IPC.
3. Shadow later:
   - PG uses the future WASM core first in shadow mode.
   - MySQL, MariaDB, and SQLite reuse the same request/result shape.
4. Shell later:
   - `psql`, `mysql-client`, and `sqlite-cli` commands stay outside SQL
     grammar.
5. Remove TS parsers only after parity:
   - Current TS completion providers remain the production path until shadow
     parity is proven.

## Acceptance Criteria

- AC-420-01: A generic completion contract exists with cursor offset helpers.
- AC-420-02: SQL request builder emits one multi-dialect request shape for
  PostgreSQL, MySQL, MariaDB, and SQLite.
- AC-420-03: Request includes dialect capabilities and shell profile without
  provider-level `dbType` branching.
- AC-420-04: UTF-16 cursor positions with multi-byte characters map to stable
  UTF-8 byte offsets.
- AC-420-05: No CodeMirror UI behavior swap in this sprint.
- AC-420-06: Focused Vitest coverage locks the new boundary.

## Out Of Scope

- Rust/WASM completion core implementation.
- Replacing current CodeMirror completion sources.
- Exhaustive MySQL/MariaDB/SQLite grammar support.
- Mongo completion refactor. Mongo remains on the existing mongosh/WASM parser
  and TS completion sources for now.

## Validation

```bash
pnpm exec vitest run \
  src/lib/completion/coreContract.test.ts \
  src/lib/sql/sqlCompletionRequest.test.ts \
  src/lib/sql/sqlCompletionContext.test.ts \
  src/lib/sql/sqlDialectProfile.test.ts

pnpm exec tsc --noEmit
pnpm exec eslint src/lib/completion/coreContract.ts src/lib/sql/sqlCompletionRequest.ts
```
