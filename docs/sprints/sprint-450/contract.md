# Sprint 450 Contract: MariaDB Adapter Identity Slice

## Goal

Make MariaDB a first-class connection/profile identity while reusing the MySQL
adapter path unless concrete incompatibility is proven.

## Dependencies

- Depends on: 447.
- Parallel lane: rdbms/mariadb.
- Can run with: 448 and 452 after 447.

## Scope

- Preserve separate MariaDB identity in connection/profile/UI surfaces.
- Route runtime through the MySQL-family adapter where compatible.
- Add version/dialect metadata needed to distinguish MariaDB behavior later.
- Add focused tests for profile, connection, and adapter selection.

## Acceptance Criteria

- AC-450-01: MariaDB is not collapsed into MySQL in user-facing identity.
- AC-450-02: Adapter reuse is explicit and covered by tests.
- AC-450-03: The implementation can expose MariaDB version/capability deltas.
- AC-450-04: No separate adapter is created without evidence.

## Out of Scope

- MariaDB-only syntax support.
- New connection UX beyond identity/profile correctness.
- Broad adapter refactor.

## Verification Plan

1. Profile and connection tests.
2. Adapter selection tests.
3. Focused runtime smoke with existing MySQL-family fixture strategy.
