# Sprint 432 Contract: MySQL LIMIT Comma Semantics

## Goal

Move MySQL/MariaDB `LIMIT offset, count` from documented parser gap to supported
client parser semantics.

## Scope

- Parse `SELECT ... LIMIT <offset>, <count>` in the Rust SQL parser.
- Preserve existing ANSI `LIMIT <count>` and `LIMIT <count> OFFSET <offset>`
  behavior.
- Map comma form to the existing AST shape: first value becomes `offset`,
  second value becomes `count`.
- Accept the same literal/placeholder value surface already accepted by
  `LIMIT` and `OFFSET`.
- Update the query-language support matrix for the narrowed semantic gap.

## Acceptance Criteria

- AC-432-01: `SELECT a FROM x LIMIT 10, 20` parses as a `SelectStatement`.
- AC-432-02: The parsed comma form records `offset = 10` and `count = 20`.
- AC-432-03: Placeholder comma form, for example `LIMIT ?, ?`, parses through
  the same `InsertValue::Placeholder` surface.
- AC-432-04: Existing `LIMIT 10` and `LIMIT 10 OFFSET 20` tests remain green.
- AC-432-05: `docs/query-language-support.md` no longer lists MySQL
  `LIMIT offset, count` as unsupported.

## Out of Scope

- MySQL/MariaDB `ON DUPLICATE KEY UPDATE`.
- Stored routines, `CALL`, `LOAD DATA`, `DELIMITER`, and scripting/control-flow
  grammar.
- Dialect-specific parse mode. The current parser is still a common client
  parser surface.

## Verification Plan

1. Focused parser tests for the comma form.
2. Full `sql-parser-core` test suite.
3. Formatting, diff, and hook validation before delivery.
