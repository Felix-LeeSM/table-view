# Sprint 451 Contract: MariaDB Semantic Delta Slice

## Goal

Identify and implement the first small MariaDB-specific semantic delta after the
adapter identity is stable.

## Dependencies

- Depends on: 450.
- Parallel lane: rdbms/mariadb.
- Blocks: 459.

## Scope

- Audit the highest-value MariaDB delta for query parsing, capability gating, or
  metadata display.
- Implement only one bounded delta with tests.
- Keep MySQL behavior unchanged.
- Document deferred MariaDB gaps.

## Acceptance Criteria

- AC-451-01: The selected delta has user-visible value and narrow blast radius.
- AC-451-02: MySQL and MariaDB behavior are separately tested.
- AC-451-03: Capability/profile metadata explains the difference.
- AC-451-04: Deferred deltas remain documented.

## Out of Scope

- Full MariaDB dialect parity.
- Separate adapter split unless the audit proves it is required.
- Multi-delta grab bag.

## Verification Plan

1. Focused parser/runtime/profile tests for the selected delta.
2. Regression tests proving MySQL behavior stays stable.
3. Docs update check.
