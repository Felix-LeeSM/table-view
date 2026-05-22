# Sprint 468 Contract: MongoDB Integration Gate

## Goal

Verify MongoDB is aligned with the shared architecture and ready to be treated
as a first-class document source.

## Dependencies

- Depends on: 467.
- Parallel lane: document/join.
- Blocks: release-level non-RDBMS claims.

## Scope

- Review MongoDB profile, connection, catalog, query language, result envelope,
  edit behavior, and safety policy together.
- Confirm no old `queryMode` path became the future execution SOT.
- Update docs/risk register for remaining document-source gaps.

## Acceptance Criteria

- AC-468-01: MongoDB support claims match tested workflows.
- AC-468-02: Document paradigm UI does not rely on RDBMS-only assumptions.
- AC-468-03: Existing RDBMS behavior is unaffected.
- AC-468-04: Remaining MongoDB risks are documented.

## Out of Scope

- Redis/Search work.
- New broader document DB support.
- Arbitrary shell.

## Verification Plan

1. Full affected MongoDB tests.
2. Cross-paradigm query/result regression tests.
3. Typecheck/lint/hook gate.
