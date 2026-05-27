# Resolved Risk Register — Table View

Resolved risk archive. The former active/deferred register is archived at
`docs/archives/risks/active-risk-register-2026-05-27.md`; current limitations
and follow-ups live in product, roadmap, and contributor docs.

Last updated: 2026-05-22

## Summary

| Status | Count |
|---|---:|
| Resolved | 17 |

## Resolved Risks

| ID | Description | Area | Origin | Resolution |
|---|---|---|---|---|
| RISK-001 | `fetchData` race condition in DataGrid | frontend/logic | 5, 11 | Sprint 12 — `fetchIdRef` counter discards stale responses |
| RISK-002 | `loadTables` failure left `loadingTables` stuck | frontend/logic | 7 | Sprint 11 — `.catch().finally()` |
| RISK-003 | `handleRefresh` failure left `loadingSchemas` stuck | frontend/logic | 7 | Sprint 11 — `.catch().finally()` |
| RISK-004 | connectionId-change scenario untested | frontend/testing | 7 | Sprint 11 — regression test added |
| RISK-005 | `row_count: 0` edge case untested | frontend/testing | 7 | Sprint 11 — regression test added |
| RISK-006 | Backend tests could not run in environment | ci | 0 | CI now runs with service containers |
| RISK-007 | `test-setup.ts` TypeScript build error | frontend/testing | 0 | Fixed in subsequent sprints |
| RISK-009 | Refetch overlay did not swallow pointer events | frontend/ui | 5, 11 | Sprint 176 — overlay swallows mouse/click/context events |
| RISK-018 | MySQL adapter missing | backend | 16 | Sprint 296 — Phase 17 closure; MySQL adapter slices A-G + coverage gate complete |
| RISK-024 | `fireEvent` act() warnings possible | frontend/testing | 24-40 | 2026-04-12 — fireEvent calls wrapped in `act()` |
| RISK-025 | Multi-window split deferred behind stub lifecycle | frontend/architecture | 149 | Sprint 150-155 — launcher/workspace split + IPC sync; ADR 0012 supersedes 0011 |
| RISK-033 | Mongo edit path P0 milestone undecided | frontend/ux | UI eval | Phase 28 roadmap + `docs/archives/roadmaps/memory-roadmap/phase-28-mongo-full-support/memory.md` define full-support edit path |
| RISK-035 | `StructurePanel` first-render empty-state flicker | frontend/ui | P2 P1 review | Sprint 176 — `hasFetched*` gates empty-state rendering |
| RISK-036 | pre-push e2e gate blocked pushes due image staleness / Vite OOM | ci/e2e | ADR-0044 | Superseded by remote PR/main smoke gate |
| RISK-039 | DataGrid edit key missed database identity | frontend/logic | code-smell-audit L1 | Sprint 433 — key expanded to `(connId, db, schema, table)` |
| RISK-040 | Connection cleanup spread across stores/callers | frontend/logic | code-smell-audit L4 | Sprint 435 — `cleanupConnectionFrontendState(connectionId)` single entry |
| RISK-041 | Code-smell audit Part B remaining six items | refactor backlog | code-smell-audit L3/L6/L7/L8/L9/L10 | Sprint 436-438 — alias removed, query boundaries split, stale guard extracted, selectors confirmed, sentinel hardened |

## Resolution Notes

### RISK-018 — MySQL adapter missing

Phase 17 closed retrospectively in Sprint 296. Evidence: `docs/sprints/sprint-296/handoff.md` records MysqlAdapter lifecycle/read/execute/stream/DDL/index/constraint/view/function/trigger/database slices plus testcontainers coverage gate.

### RISK-033 — Mongo edit milestone undecided

The risk was about absence of roadmap, not completion of Mongo full support. It is resolved because `docs/phases/phase-28.md` and `docs/archives/roadmaps/memory-roadmap/phase-28-mongo-full-support/memory.md` now lock the edit path: `$set` DataGrid edits, QuickLook advanced operators, `_id` disabled, nested one-depth promote, BSON editors, bulkWrite and transaction toggle.

### RISK-039 — DataGrid edit key database identity

Sprint 433 expanded pending edit keys to include database identity and locked commit/remount/purge regression coverage.

### RISK-040 — Connection cleanup spread

Sprint 435 added a single frontend cleanup entry point and routed disconnect/delete/status transitions through it.

### RISK-041 — Code-smell audit Part B

Sprint 436 removed `schemaStore.clearSchema`; Sprint 437 split workspace query hints from dispatched history modes and extracted the stale-query guard; Sprint 438 hardened `EMPTY_ENTRY`. L9 remained memo-level because drift was zero and no code action was warranted.
