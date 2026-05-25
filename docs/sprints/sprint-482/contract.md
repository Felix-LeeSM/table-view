---
review-profile: code
---

# Sprint 482 Contract: PostgreSQL Parser/Safe Mode Kickoff

## Goal

Start Phase 32's PostgreSQL query/workbench parity lane by closing the first
client parser/Safe Mode gap for common PostgreSQL read-only SELECT forms.

## Dependencies

- Depends on: Sprint 481 release gate decision.
- Phase: 32 PostgreSQL lane.
- Blocks: later PostgreSQL completion, EXPLAIN, and result-envelope parity
  slices.

## Scope

- Support no-FROM SELECT in the Rust SQL parser for common read-only forms such
  as `SELECT 1`.
- Support bare function calls in SELECT lists without requiring `OVER`, for
  common PostgreSQL reads such as `SELECT now()` and `SELECT count(*) FROM t`.
- Preserve existing window-function AST shape for `func(...) OVER (...)`.
- Keep `DO $$ ... $$`, PL/pgSQL bodies, `MERGE`, and extension-specific
  operator/type tolerance out of scope for this slice.
- Update support docs so PostgreSQL parser/Safe Mode claims match code.

## Acceptance Criteria

- AC-482-01: `parse("SELECT 1")` returns `kind="select"` with an empty `from`
  list and a literal expression item.
- AC-482-02: `parse("SELECT count(*) FROM users")` returns a function-call
  expression item, not `unsupported-expression`.
- AC-482-03: `parse("SELECT row_number() OVER (...) FROM users")` keeps the
  existing `window-function` shape.
- AC-482-04: Safe Mode still classifies parsed SELECT statements as
  `kind="select"`, `severity="info"`, `reasons=[]`.
- AC-482-05: `MERGE` remains `unsupported-statement`; `DO $$ ... $$` remains
  unsupported/deferred in docs.

## Out of Scope

- Full PostgreSQL expression grammar.
- Function calls in WHERE/HAVING/JOIN predicates.
- Function-call aliases such as `SELECT now() AS ts`.
- Schema-qualified functions, nested function arguments, `DISTINCT`, and
  expression arguments inside function calls.
- PostgreSQL extension pack detection/completion.
- EXPLAIN plan viewer UI/runtime.

## Verification Plan

1. RED parser tests for no-FROM SELECT and bare SELECT-list function calls.
2. Rust parser-core tests.
3. Frontend typecheck and focused SQL facade/Safe Mode tests.
4. Regenerate SQL WASM and check size budget.
5. Documentation drift check.

## WASM Budget

- Budget: SQL parser WASM <= 80 KiB gzip.
- Measured after regeneration: SQL gzip 80,056 bytes.
- Validation command: `bash scripts/check-wasm-size.sh`.

### Required Checks

1. `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml`
2. `pnpm build:sql-wasm`
3. `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
4. `pnpm exec tsc -b --pretty false`
5. `bash scripts/check-wasm-size.sh`
6. `git diff --check`
