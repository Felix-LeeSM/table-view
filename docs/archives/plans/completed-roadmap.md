# Completed Plan Archive

This file keeps completed sequencing out of `docs/PLAN.md`. Detailed evidence
stays in `docs/sprints/sprint-N/`; this file is only an index.

Last updated: 2026-06-12

## Completed Sequences

| Sequence | Status | Evidence |
|---|---|---|
| Foundation / query / editing baseline | complete | Phases 1-4 |
| Multi-window launcher/workspace split | complete | Phase 12, Sprint 150-155 |
| Preview/theme/groups/recent closure | closed | Phases 13-16 |
| MySQL adapter | complete | Phase 17, Sprint 276-296, `docs/sprints/sprint-296/handoff.md` |
| Export / RDB inline edit / Safe Mode | closed | Phases 21-23 |
| Refactor cycle 189-198 | complete | `docs/sprints/sprint-189/` through `sprint-198/` |
| Refactor cycle 199-209 | complete | `docs/sprints/sprint-199/` through `sprint-209/` |
| Refactor cycle 210-224 | complete except deferred P10 3b/4 | `docs/sprints/sprint-210/` through `sprint-224/` |
| DDL UI parity surfaces | closed | Phases 24-27, Sprint 226-237 |
| Language completion architecture | complete | Phase 31, Sprint 420-430 |
| Risk closure follow-up | complete | Sprint 433-438, `docs/archives/risks/resolved-risks.md` |

## Completed Semantic-Widening Slices

| Sprint | Result |
|---|---|
| 432 | MySQL-family `LIMIT offset,count` parser semantics |
| 434 | MySQL/MariaDB `ON DUPLICATE KEY UPDATE` parser semantics |
| 439 | Narrow common `CALL` parser semantics |

## Retired / Moved Planning Content

| Old content | Current home |
|---|---|
| Long historical PLAN sections | this archive + sprint handoffs |
| Completed phase list | `docs/archives/phases/README.md` |
| Resolved risk table/log | `docs/archives/risks/resolved-risks.md` |
| Active ordering | `docs/PLAN.md` |
| UX law action plan | preserved as retired reference; sprint-176-180 artifacts + `docs/ux-laws-mapping.md` remain current |
| Legacy Phase 5-9 sketches | preserved under `docs/archives/phases/retired/`; indexed in `docs/archives/phases/README.md` |
| Archived 2026-04-10 test improvement snapshot | preserved under `docs/archives/test-plans/`; superseded by later sprint evidence |
| 2026-05-19 refactor backlog draft | preserved under `docs/archives/backlogs/refactor-audit-2026-05-19/`; active refactor routing now lives in `docs/ROADMAP.md` plus live GitHub milestones/issues |
| 2026-05-01 product support/comparison snapshots | preserved under `docs/archives/product-snapshots/`; superseded by `docs/product/README.md`, `docs/product/query-language-support.md`, and `docs/product/known-limitations.md` |
| 2026-05-09 fixture workflow planning handoff | preserved under `docs/archives/workflows/`; not active unless re-linked from `docs/ROADMAP.md` or a live GitHub issue |

## Completed GitHub Refactor Buckets

These are completed GitHub execution buckets. Active routing stays in
`docs/ROADMAP.md` plus live GitHub milestone/issue state.

| Bucket | Parent | Status | Current durable SOT |
|---|---|---|---|
| 09.10 Refactor 01 - Directory Topology | #572 | closed | `docs/contributor-guide/repository-topology-inventory.md`, `docs/contributor-guide/source-root-migration-constraints.md`, hook router scripts, and related memory rooms |
| 09.20 Refactor 02 - Frontend Domain Strangler | #573 | closed | frontend/domain memory rooms, source-root constraints, typed wrapper/import-boundary checks, and sprint evidence |
| 09.30 Refactor 03 - Backend Adapter Contracts | #574 | closed | data-source/query-language architecture memory, backend contract tests, and `docs/ROADMAP.md` H1/H7 summaries |
| 09.40 Refactor 04 - Fixtures And Test Topology | #575 | closed | `docs/contributor-guide/fixture-test-topology-inventory.md`, `docs/contributor-guide/testing-and-quality.md`, fixture memory, and smoke-routing decisions |
