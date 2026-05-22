# Sprint 459 Contract: RDBMS Integration Gate

## Goal

Prove the RDBMS-first wave is coherent before moving attention to ERD and
non-RDBMS implementation.

## Dependencies

- Depends on: 449, 451, 454, 457, 458.
- Parallel lane: rdbms/join.
- Blocks: 460 and release-level gates.

## Scope

- Run an integrated review over PostgreSQL, MySQL, MariaDB, SQLite, and DuckDB
  profiles, adapters, connection kinds, query language support, result envelopes,
  and capability gates.
- Update active plan/risk docs for any remaining parity gaps.
- Verify no RDBMS-specific code path regressed PostgreSQL baseline behavior.

## Acceptance Criteria

- AC-459-01: RDBMS sources have coherent profiles and capability behavior.
- AC-459-02: PostgreSQL baseline tests remain green.
- AC-459-03: MariaDB/SQLite/DuckDB support claims match tested workflows.
- AC-459-04: Remaining gaps are documented as active risks or follow-up sprints.

## Out of Scope

- ERD implementation.
- MongoDB/Redis/Search feature work.
- New broad architecture changes.

## Verification Plan

1. Full affected frontend/backend RDBMS tests.
2. Fixture smoke for each RDBMS lane available locally.
3. Typecheck/lint/hook gate.
4. Documentation/risk review.
