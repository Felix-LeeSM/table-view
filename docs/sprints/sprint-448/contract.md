# Sprint 448 Contract: MySQL-Family Routine And User-Variable Semantics

## Goal

Continue MySQL/MariaDB semantic widening by adding the next narrow parser/safety
slice after common `CALL`: routine arguments and user-variable recognition.

## Dependencies

- Depends on: 447.
- Parallel lane: rdbms/mysql.
- Can run with: 450 and 452 after 447.

## Scope

- Extend the local parser only where syntax is common and bounded.
- Recognize MySQL-family user variables in routine-call argument positions if
  accepted by the safety model.
- Keep unsupported expressions documented instead of accepting broad scripting.
- Update Rust/WASM and TypeScript facade coverage if parser output changes.

## Acceptance Criteria

- AC-448-01: Supported user-variable cases parse deterministically.
- AC-448-02: Unsupported routine expressions still fail or warn clearly.
- AC-448-03: Safe Mode classification remains conservative for opaque routines.
- AC-448-04: Query-language support docs match implementation.

## Out of Scope

- Stored routine bodies.
- `DELIMITER`.
- `LOAD DATA`.
- MySQL client scripting.

## Verification Plan

1. Focused parser/safety tests.
2. WASM facade regression tests if exports change.
3. Query-language support doc check.
