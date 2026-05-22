# Sprint 430 Contract: Completion Support Matrix Hardening

## Goal

Close Phase 31 by making the support matrix explicit. "100% completion coverage"
means current UI vocabulary coverage only. Context routing, parser semantics,
runtime execution, and server-version capability gates remain separate support
layers.

## Scope

- Update `docs/query-language-support.md` with completion coverage layers.
- Add explicit MariaDB and SQLite sections.
- Document parser/runtime semantic gaps for SQL and MongoDB.
- Update `docs/archives/phases/completed/phase-31.md` and `docs/PLAN.md` so the long-term plan
  does not lose Phase 31 closure criteria.

## Acceptance Criteria

- AC-430-01: The support matrix defines vocabulary coverage, context routing,
  and semantic support as separate layers.
- AC-430-02: MySQL/MariaDB/SQLite support gaps are explicit.
- AC-430-03: MongoDB vocabulary coverage and whitelisted execution limits are
  explicit.
- AC-430-04: Version/capability gate absence is documented.
- AC-430-05: Phase 31 docs state closure and route follow-up work to feature
  backlog, not completion architecture.

## Out of Scope

- Runtime behavior changes.
- New completion vocabulary.
- Parser semantic widening.
- Server-version or deployment capability filtering.
