# Sprint 439 Contract: Common CALL Parser Semantics

## Goal

Move narrow `CALL` statements, motivated by MySQL/MariaDB procedure dispatch,
from the documented parser semantic gap to supported top-level client parser
semantics.

## Scope

- Parse `CALL proc()` as a top-level `call` AST result.
- Parse schema-qualified procedure names such as `CALL schema.proc(...)`.
- Keep the parser dialectless: this is common client parser behavior, not a
  MySQL-only dialect gate.
- Parse comma-separated arguments using the existing local value surface:
  literals, `DEFAULT`, and placeholders (`?`, `$1`, `:name`).
- Serialize bare procedure names with `procedure.schema: null`.
- Classify parsed `CALL` statements as `routine-call` / `warn` in Safe Mode
  because stored routine side effects are opaque to the client parser.
- Add Rust AST/parser coverage, TypeScript facade typing, and real checked-in
  WASM regression coverage.
- Regenerate the checked-in SQL WASM artifact because the exported AST shape
  changes.
- Update the query-language support matrix.

## Acceptance Criteria

- AC-439-01: `CALL refresh_user_stats()` parses as a `call` statement AST.
- AC-439-02: `CALL schema.proc(?, 'x', 1)` parses with a qualified procedure
  reference and ordered arguments.
- AC-439-03: Argument grammar remains narrow; function calls, arithmetic,
  subqueries, bare identifiers, and MySQL user variables stay outside the local
  parser subset.
- AC-439-04: Existing parser tests remain green.
- AC-439-05: The checked-in SQL WASM artifact parses the same `call` shape
  through `parseSql`, including `schema: null` for bare calls.
- AC-439-06: Docs move narrow MySQL/MariaDB `CALL` semantics out of the
  unsupported parser bucket while preserving stored routine body, `DELIMITER`,
  `LOAD DATA`, and control-flow gaps.

## Out of Scope

- Stored procedure/function/event bodies.
- `DELIMITER` scripting.
- `LOAD DATA`.
- Transaction/control-flow scripting.
- Broad `CALL` argument expressions, OUT/INOUT variable semantics, or user
  variable parsing.
- Broad `ON DUPLICATE KEY UPDATE` RHS expressions.
- Frontend store or execution adapter behavior changes.

## Verification Plan

1. Focused Rust parser tests for no-arg, qualified, placeholder/literal, and
   narrow-grammar rejection cases.
2. Full `sql-parser-core` test suite.
3. Regenerate `src/lib/sql/wasm/`.
4. Focused frontend facade and real-WASM Vitest suites.
5. TypeScript build, WASM size check, diff check, and Lefthook validation.
