# Sprint 483 Handoff: PostgreSQL Function-Call Expression Widening

## Landed

- Simple unqualified function calls now parse as PostgreSQL-style predicate and
  HAVING comparison left-hand expressions, e.g. `WHERE lower(name) = 'felix'` and
  `HAVING count(*) > 1`.
- Function-call SELECT-list aliases are consumed for `AS alias` and bare alias
  forms without changing the existing `function-call` AST shape.
- SELECT-list window functions keep the existing `window-function` shape.
- Predicate-position window functions, nested function calls, schema-qualified
  functions, `DISTINCT`, and arbitrary arithmetic/string expression arguments
  remain unsupported.
- SQL facade/Safe Mode tests, generated SQL WASM, and support docs were updated.

## RED Evidence

- RED commit: `c15851ff` (`test: RED postgres function-call predicate parse`).
- RED command:
  `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml ac_483 --quiet`.
- Failure captured in `docs/sprints/sprint-483/red-state.log`.
- RED patch captured in `docs/sprints/sprint-483/red-test.patch`.

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --quiet`
  passed: 536 tests.
- `pnpm build:sql-wasm` passed.
- `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
  passed: 191 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `bash scripts/check-wasm-size.sh` passed: SQL gzip 80,322 bytes / 81,920
  budget; Mongo gzip 52,169 bytes / 54,272 budget.

## Notes

- The TypeScript facade tests continue to mock the WASM boundary; Rust
  parser-core tests cover the actual grammar.
- The parser god-file warning is pre-existing. This sprint kept changes narrow
  and did not start decomposition.
