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

- `git apply docs/sprints/sprint-482/red-test.patch` followed by
  `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml ac_482 --quiet`
  failed before implementation with 3 failing parser tests.
- Captured in `docs/sprints/sprint-482/red-state.log` and
  `docs/sprints/sprint-482/red-test.patch`.

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --quiet`
  passed: 529 tests.
- `pnpm build:sql-wasm` passed.
- `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
  passed: 185 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `bash scripts/check-wasm-size.sh`
  passed: SQL gzip 80,056 bytes / 81,920 budget; Mongo gzip 52,169 bytes /
  54,272 budget.
- `PATH=<repo-node_modules>:$PATH bash scripts/review/run-checks.sh 482`
  passed: 6/6 checks.

## Notes

- The linked worktree did not have local `node_modules`; pnpm commands used an
  existing repo `node_modules/.bin` on `PATH`.
- `DO $$ ... $$`, PL/pgSQL bodies, `MERGE`, predicate function calls, and
  function-call aliases remain out of scope.
- Subagent review found one low-severity docs overclaim; it was fixed by
  narrowing the support claim and adding `SELECT now()` regression tests.
