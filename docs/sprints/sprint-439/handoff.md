# Sprint 439 Handoff: MySQL/MariaDB CALL Parser Semantics

## Implemented Behavior

- The Rust SQL parser now accepts narrow MySQL/MariaDB `CALL` statements as a
  top-level `call` AST variant.
- `CallStatement` records:
  - `procedure.schema` as `null`/`Some` for bare or schema-qualified procedure
    names.
  - `procedure.name`.
  - ordered `arguments` using the existing `InsertValue` wire shape.
- Supported argument values are literals, `DEFAULT`, and placeholders (`?`,
  `$1`, `:name`).
- The TypeScript facade mirrors the new `call` wire shape through
  `SqlCallStatement`.
- `sqlSafety` keeps `CALL` on the existing fallback path because this slice
  parses dispatch syntax but does not model stored routine side effects.
- The checked-in SQL WASM artifact has been regenerated.
- `docs/query-language-support.md` lists narrow MySQL/MariaDB `CALL` semantics
  as supported client parser behavior.

## Residual Gap

The parser still intentionally rejects or falls back for broader `CALL`
semantics: function call arguments, arithmetic, subqueries, bare identifiers,
MySQL user variables such as `@name`, and OUT/INOUT parameter modeling. Stored
routine bodies, `DELIMITER`, `LOAD DATA`, and transaction/control-flow scripting
remain unsupported.

## Notes For Evaluator

- `CALL refresh_user_stats()` serializes as `kind: "call"` with an empty
  `arguments` array.
- `CALL reporting.refresh_user_stats(?, 'x', 1)` serializes the procedure as
  `{ schema: "reporting", name: "refresh_user_stats" }` and preserves argument
  order.
- `DEFAULT` is accepted because this slice reuses the existing local
  `InsertValue` value surface; server execution remains the final validity
  check for routine signatures and argument semantics.

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml call_ -- --nocapture`
  - Pass: 5 tests.
- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml`
  - Pass: 523 tests.
- `pnpm build:sql-wasm`
  - Pass; regenerated `src/lib/sql/wasm/`.
- `pnpm exec vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlWasmArtifact.test.ts`
  - Pass: 2 files, 58 tests.
- `pnpm wasm:size`
  - Pass: SQL wasm gzip 79,301 bytes / 81,920 byte budget; Mongo wasm gzip
    52,169 bytes / 54,272 byte budget.
- `pnpm exec tsc -b --pretty false`
  - Pass.
- `git diff --check`
  - Pass.
- `pnpm exec lefthook validate`
  - Pass.
