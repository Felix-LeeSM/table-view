# Sprint 432 Handoff: MySQL LIMIT Comma Semantics

## Implemented Behavior

- The Rust SQL parser now accepts MySQL-family `LIMIT offset, count`.
- The checked-in SQL WASM artifact has been regenerated, so frontend
  `parseSql` / `parseSqlPreloaded` sees the same behavior.
- The existing `LimitClause` AST is reused:
  - comma first value -> `offset`
  - comma second value -> `count`
- ANSI forms are unchanged:
  - `LIMIT count`
  - `LIMIT count OFFSET offset`
- Literal and placeholder values use the existing `InsertValue` parser.

## Notes For Evaluator

- The parser remains dialect-agnostic. This slice widens the common client
  parser so MySQL/MariaDB Safe Mode/editor analysis can understand a vendor
  form that was previously rejected.
- The slice does not implement `ON DUPLICATE KEY UPDATE` or other MySQL
  scripting/routine grammar.
- The support matrix should describe this as semantic support for
  MySQL/MariaDB `LIMIT offset,count`, not as full MySQL dialect validation.

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml ac_393a_e09 -- --nocapture`
- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --test parse_sql_backend`
- `pnpm build:sql-wasm`
- `pnpm exec vitest run src/lib/sql/sqlWasmArtifact.test.ts`
- `pnpm wasm:size`
- `pnpm exec prettier --check docs/PLAN.md docs/query-language-support.md docs/sprints/sprint-432/contract.md docs/sprints/sprint-432/handoff.md`
- `git diff --check`
- `pnpm exec lefthook validate`
