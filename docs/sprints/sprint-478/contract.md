# Sprint 478 Contract: Adapter Conformance Test Matrix

## Goal

Define a conformance matrix that every active adapter family must satisfy at its
declared support level.

## Dependencies

- Depends on: 477.
- Parallel lane: quality/conformance.
- Blocks: 481.

## Scope

- Define conformance levels for profile, connection, catalog, query, result,
  edit, and safety behavior.
- Add a machine-checkable or table-driven test surface where practical.
- Mark unsupported features explicitly rather than leaving gaps implicit.
- Pilot against RDBMS and one non-RDBMS adapter family if available.

## Acceptance Criteria

- AC-478-01: Support claims map to conformance checks.
- AC-478-02: Unsupported/deferred features are explicit.
- AC-478-03: Adding a new DBMS requires choosing conformance level.
- AC-478-04: Test matrix can run in focused mode.

## Out of Scope

- 100% implementation for every future paradigm.
- Full CI parallelization.
- External certification.

## Verification Plan

1. Conformance matrix tests.
2. Pilot adapter checks.
3. Docs update check.
