---
review-profile: code
---

# Sprint 447 Contract: Data Source Alignment Integration Gate

## Goal

Join sprints 440-446 and prove the current app fits the data-source extension
architecture with no user-facing regression.

## Dependencies

- Depends on: 442, 443, 444, 445, 446.
- Parallel lane: join.
- Blocks: RDBMS-first sprints and non-RDBMS foundation sprints.

## Scope

- Run integration checks over profile lookup, capability gates, query language
  metadata, result envelope conversion, backend adapter assumptions, and
  connection-kind metadata.
- Update docs only where implementation evidence changed the contract.
- Preserve legacy `queryMode` compatibility.
- Preserve current backend mismatch and unsupported-source behavior.

## Acceptance Criteria

- AC-447-01: PostgreSQL/MySQL/MariaDB/SQLite/MongoDB profiles are internally
  coherent.
- AC-447-02: Query tabs, result rendering, and connection forms do not regress.
- AC-447-03: New DBMS work can start by adding profile/adapter contracts rather
  than changing shared architecture first.
- AC-447-04: Follow-up risks are recorded in `docs/RISKS.md` or sprint docs.

## Out of Scope

- New DBMS support.
- Feature expansion.
- Broad refactors after the integration gate is green.

## Verification Plan

1. Full affected frontend test set.
2. Affected Rust test set.
3. Typecheck/lint/hook gate.
4. Documentation diff review.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
