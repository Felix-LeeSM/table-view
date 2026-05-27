---
review-profile: code
---

# Sprint 483 Contract: PostgreSQL Function-Call Expression Widening

## Goal

Continue Phase 32's PostgreSQL query/workbench parity lane by letting common
function-call expressions participate in read-only SELECT analysis beyond the
SELECT list.

## Dependencies

- Depends on: Sprint 482 PostgreSQL parser/Safe Mode kickoff.
- Phase: 32 PostgreSQL lane.
- Blocks: later PostgreSQL extension operator/type tolerance, completion packs,
  and EXPLAIN parity slices.

## Scope

- Support simple unqualified function calls in predicate/value expression
  positions, starting with common PostgreSQL reads like
  `WHERE lower(name) = 'a'`.
- Support simple function-call aliases in SELECT-list position:
  `SELECT now() AS ts`, `SELECT count(*) total FROM users`.
- Keep function-call arguments limited to the current simple argument surface:
  `*`, column refs, literals, and placeholders.
- Preserve existing window-function AST shape for `func(...) OVER (...)`.
- Keep `DO $$ ... $$`, PL/pgSQL bodies, `MERGE`, schema-qualified functions,
  nested function calls, `DISTINCT`, and arbitrary arithmetic expressions out of
  scope.
- Update support docs so PostgreSQL parser/Safe Mode claims match code.

## Acceptance Criteria

- AC-483-01: `parse("SELECT name FROM users WHERE lower(name) = 'felix'")`
  returns a SELECT whose `where` is an `expression-comparison` with a
  `function-call` left side.
- AC-483-02: `parse("SELECT region FROM sales GROUP BY region HAVING count(*) > 1")`
  returns a SELECT whose `having` is an `expression-comparison` with a
  `function-call` left side.
- AC-483-03: `parse("SELECT now() AS ts")` returns a `function-call` SELECT-list
  item and consumes the alias instead of failing on trailing `AS`.
- AC-483-04: `parse("SELECT count(*) total FROM users")` returns a
  `function-call` SELECT-list item and consumes the bare alias.
- AC-483-05: Safe Mode classifies parsed SELECT statements from AC-483-01 and
  AC-483-02 as `kind="select"`, `severity="info"`, `reasons=[]`.
- AC-483-06: `row_number() OVER (...)` keeps the existing `window-function`
  shape; nested function calls and schema-qualified functions stay unsupported.

## Out of Scope

- Full PostgreSQL expression grammar.
- Nested function arguments such as `lower(trim(name))`.
- Schema-qualified functions such as `public.normalize(name)`.
- `DISTINCT` function arguments.
- Arithmetic/string concatenation expressions.
- PostgreSQL extension pack detection/completion.
- EXPLAIN plan viewer UI/runtime.

## Verification Plan

1. RED parser tests for predicate function calls.
2. Rust parser-core tests.
3. Frontend SQL facade/Safe Mode tests.
4. Regenerate SQL WASM and check size budget.
5. Frontend typecheck.
6. Documentation drift check.

## Required Checks

1. `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml`
2. `pnpm build:sql-wasm`
3. `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
4. `pnpm exec tsc -b --pretty false`
5. `bash scripts/check-wasm-size.sh`
6. `git diff --check origin/main...HEAD`
