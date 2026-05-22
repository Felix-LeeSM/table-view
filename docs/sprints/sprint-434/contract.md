# Sprint 434 Contract: MySQL ON DUPLICATE KEY UPDATE Parser Semantics

## Goal

Move MySQL/MariaDB `INSERT ... ON DUPLICATE KEY UPDATE ...` from documented
parser semantic gap to supported client parser semantics.

## Scope

- Parse `INSERT ... ON DUPLICATE KEY UPDATE <col> = <rhs>[, ...]` in the Rust
  SQL parser.
- Preserve existing PostgreSQL `ON CONFLICT` behavior and INSERT source
  behavior.
- Add an explicit AST/WASM/TypeScript wire shape for the MySQL-family upsert
  clause.
- Support comma-separated assignments and preserve assignment column order.
- Support literal, `DEFAULT`, and placeholder RHS values.
- Support the common MySQL `VALUES(column)` RHS form.
- Regenerate the checked-in SQL WASM artifact because the exported INSERT AST
  shape changes.
- Update the query-language support matrix and plan notes.

## Acceptance Criteria

- AC-434-01: `INSERT INTO users (id, name) VALUES (1, 'a') ON DUPLICATE KEY
  UPDATE name = 'b'` parses as `Insert`.
- AC-434-02: Multiple assignments parse and preserve column names/order.
- AC-434-03: Placeholder RHS parses.
- AC-434-04: `VALUES(name)` RHS parses as an explicit `values-column` value.
- AC-434-05: Existing PostgreSQL `ON CONFLICT` tests stay green.
- AC-434-06: The checked-in SQL WASM artifact parses the same MySQL-family
  upsert shape through `parseSql`.
- AC-434-07: Docs no longer list MySQL/MariaDB `ON DUPLICATE KEY UPDATE` as an
  unsupported parser semantic gap, while documenting the remaining RHS
  expression limits.

## Out of Scope

- Full MySQL dialect mode or semantic validation.
- Arbitrary RHS expressions in the upsert assignment list, including arithmetic,
  function calls, subqueries, or bare identifier references.
- Stored routines, `CALL`, `LOAD DATA`, `DELIMITER`, transaction/control-flow
  scripting, and other MySQL-only statement families.
- Changing execution adapter behavior.

## Verification Plan

1. Focused Rust parser tests for literal, placeholder, assignment order, and
   `VALUES(column)` RHS.
2. Full `sql-parser-core` test suite.
3. Regenerate `src/lib/sql/wasm/`.
4. Focused frontend facade and real-WASM Vitest suites.
5. TypeScript build, WASM size check, diff check, and Lefthook validation.
