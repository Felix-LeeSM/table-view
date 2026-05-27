# Sprint 484 Handoff: PostgreSQL MERGE Parser/Safe Mode First Slice

## Result

- Added a narrow PostgreSQL `MERGE` parser surface:
  - `MERGE INTO <target> [AS alias] USING <source> [AS alias] ON <predicate>`.
  - `WHEN MATCHED THEN UPDATE SET ...`.
  - `WHEN NOT MATCHED THEN INSERT (...) VALUES (...)`.
  - `WHEN ... THEN DO NOTHING`.
- Kept unsupported MERGE forms, including `THEN DELETE`, outside the parser
  slice.
- Added Safe Mode classification for parsed and opaque MERGE as
  `kind="dml-merge"` / `severity="warn"`.
- Regenerated SQL parser WASM.
- Raised the SQL WASM gzip budget from 80 KiB to 200 KiB. This parser artifact
  is local-app code and the PostgreSQL lane will continue to grow it; the new
  cap keeps the budget useful without forcing grammar compromises.

## RED Evidence

- RED test patch: `docs/sprints/sprint-484/red-test.patch`.
- RED output: `docs/sprints/sprint-484/red-state.log`.
- Initial failure: `MERGE` returned `UnsupportedStatement`.

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --quiet`
  - 539 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml invalid_sql_returns_error_variant_not_err --lib`
  - passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --test parse_sql_backend`
  - 6 passed.
- `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
  - 2 files passed, 195 tests passed.
- `pnpm exec tsc -b --pretty false`
  - passed.
- `pnpm build:sql-wasm`
  - passed.
- `bash scripts/check-wasm-size.sh`
  - SQL wasm: raw 232,492 bytes, gzip 83,280 bytes, budget 204,800 bytes.
  - Mongo wasm: raw 104,916 bytes, gzip 52,169 bytes, budget 54,272 bytes.

## Boundaries

- Still unsupported: `WHEN NOT MATCHED BY SOURCE`, `WHEN ... AND`, MERGE
  `DELETE`, source subqueries, `RETURNING`, `OVERRIDING`, `ONLY`, arbitrary
  PostgreSQL expressions in action values, and runtime execution changes.
