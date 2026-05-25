# Sprint 482 Handoff: PostgreSQL Parser/Safe Mode Kickoff

## Landed

- PostgreSQL-style no-FROM projection SELECT parses as `kind="select"` with
  `from: []`.
- SELECT-list function calls without `OVER` parse as
  `kind="function-call"`.
- `SELECT now()` is pinned as a no-FROM function-call regression case.
- Existing `func(...) OVER (...)` keeps the `window-function` AST shape.
- Predicate-position function calls remain `unsupported-expression`.
- SQL facade, Safe Mode tests, generated WASM, and support docs were updated.

## RED Evidence

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml ac_482 --quiet`
  failed before implementation because `SelectExpr::FunctionCall` did not
  exist.
- Captured in `docs/sprints/sprint-482/red-state.log`.

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --quiet`
  passed: 529 tests.
- `PATH=/Users/felix/Desktop/study/view-table/node_modules/.bin:$PATH pnpm build:sql-wasm`
  passed.
- `PATH=/Users/felix/Desktop/study/view-table/node_modules/.bin:$PATH pnpm exec vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
  passed: 185 tests.
- `PATH=/Users/felix/Desktop/study/view-table/node_modules/.bin:$PATH pnpm exec tsc -b --pretty false`
  passed.
- `PATH=/Users/felix/Desktop/study/view-table/node_modules/.bin:$PATH pnpm wasm:size`
  passed: SQL gzip 80,056 bytes / 81,920 budget; Mongo gzip 52,169 bytes /
  54,272 budget.

## Notes

- The worktree did not have local `node_modules`; commands used the primary
  worktree's `node_modules/.bin` on `PATH`.
- `DO $$ ... $$`, PL/pgSQL bodies, `MERGE`, predicate function calls, and
  function-call aliases remain out of scope.
- Subagent review found one low-severity docs overclaim; it was fixed by
  narrowing the support claim and adding `SELECT now()` regression tests.
