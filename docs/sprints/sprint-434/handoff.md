# Sprint 434 Handoff: MySQL ON DUPLICATE KEY UPDATE Parser Semantics

## Implemented Behavior

- The Rust SQL parser now accepts MySQL/MariaDB
  `INSERT ... ON DUPLICATE KEY UPDATE`.
- `InsertStatement` has a new `on_duplicate_key_update` slot separate from
  PostgreSQL `on_conflict`.
- Assignment order is preserved in `assignments`.
- RHS support includes:
  - literals
  - `DEFAULT`
  - placeholders: `?`, `$1`, `:name`
  - `VALUES(column)`, serialized as `{ "kind": "values-column", "column": ... }`
- The checked-in SQL WASM artifact has been regenerated.
- TypeScript exposes the new wire shape through `SqlOnDuplicateKeyUpdate`.
- `docs/query-language-support.md` now lists the MySQL-family upsert clause as
  supported client parser semantics.

## Residual Gap

The upsert assignment RHS remains intentionally narrow. The client parser still
does not accept arithmetic expressions, function calls, subqueries, or arbitrary
bare identifiers on the RHS of `ON DUPLICATE KEY UPDATE`. Those are documented
as the remaining semantic widening work instead of blocking this slice.

## Notes For Evaluator

- PostgreSQL `ON CONFLICT` remains in the existing `on_conflict` slot.
- MySQL/MariaDB upsert semantics use the new `on_duplicate_key_update` slot, so
  consumers can distinguish the dialect form without inspecting SQL text.
- The parser is still dialect-agnostic; this widens the common client parser
  surface for Safe Mode/editor analysis and does not validate server
  capabilities.

## Verification

- `cd src-tauri && cargo fmt --check`
  - Pass.
- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml`
  - Pass: 519 tests.
- `pnpm build:sql-wasm`
  - Pass; regenerated `src/lib/sql/wasm/`.
- `pnpm exec vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlWasmArtifact.test.ts`
  - Pass: 2 files, 56 tests.
- `pnpm wasm:size`
  - Pass: SQL wasm gzip 78,781 bytes / 81,920 byte budget; Mongo wasm gzip
    52,169 bytes / 54,272 byte budget.
- `pnpm exec tsc -b --pretty false`
  - Pass.
- `git diff --check`
  - Pass.
- `pnpm exec lefthook validate`
  - Pass.
