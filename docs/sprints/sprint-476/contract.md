---
review-profile: code
---

# Sprint 476 Contract: MongoDB Integration Gate

## Goal

Verify MongoDB is aligned with the shared architecture and ready to be treated
as a first-class document source.

## Dependencies

- Depends on: 475.
- Parallel lane: document/join.
- Blocks: release-level non-RDBMS claims.

## Scope

- Review MongoDB profile, connection, catalog, query language, result envelope,
  edit behavior, and safety policy together.
- Confirm no old `queryMode` path became the future execution SOT.
- Update docs/risk register for remaining document-source gaps.

## Acceptance Criteria

- AC-476-01: MongoDB support claims match tested workflows.
- AC-476-02: Document paradigm UI does not rely on RDBMS-only assumptions.
- AC-476-03: Existing RDBMS behavior is unaffected.
- AC-476-04: Remaining MongoDB risks are documented.

## Out of Scope

- Redis/Search work.
- New broader document DB support.
- Arbitrary shell.

## Verification Plan

1. Full affected MongoDB tests.
2. Cross-paradigm query/result regression tests.
3. Typecheck/lint/hook gate.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
