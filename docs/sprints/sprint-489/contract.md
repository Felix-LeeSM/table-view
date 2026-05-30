---
review-profile: code
---

# Sprint 489 Contract: PostgreSQL Explain Plan Readability

## Goal

Continue Phase 32's PostgreSQL query/workbench parity lane by turning the
existing live `EXPLAIN (ANALYZE, FORMAT JSON)` payload into a readable query
workbench plan summary/tree.

## Dependencies

- Depends on: Sprint 488 detected PostgreSQL extension completion packs.
- Phase: 32 PostgreSQL lane.
- Tracks: #276.

## Scope

- Preserve the existing `explain_rdb_query` / `ExplainViewer` live wire.
- Add a typed PostgreSQL plan extraction helper for the top-level `Plan` node
  returned by `EXPLAIN (ANALYZE, FORMAT JSON)`.
- Render node type, relation/index, costs, row estimates, actual timing, loops,
  row-removal details, and common conditions when present.
- Render nested child `Plans` as a readable tree.
- Keep raw JSON available for PostgreSQL and as fallback for unknown payloads.
- Keep Mongo explain dispatch/rendering on the raw JSON path.

## Acceptance Criteria

- AC-489-01: PostgreSQL/RDB explain output renders a readable plan summary when
  the response is the expected `[{ Plan: ... }]` shape.
- AC-489-02: Child `Plans` render as a nested tree with stable labels.
- AC-489-03: Unknown/non-PostgreSQL explain payloads still render raw JSON.
- AC-489-04: Mongo explain dispatch and rendering remain unchanged.
- AC-489-05: Existing refresh and error states keep working.
- AC-489-06: Product/support docs remain accurate for Explain scope.

## Out of Scope

- Backend EXPLAIN SQL changes.
- EXPLAIN safety policy changes.
- Visual graph plan rendering.
- Plan caching.
- Mongo plan shape normalization.

## Required Checks

1. `pnpm vitest run src/lib/explain/postgresPlan.test.ts src/components/query/ExplainViewer.test.tsx --reporter=dot`
2. `pnpm exec tsc -b --pretty false`
3. `pnpm exec prettier --check docs/sprints/sprint-489/contract.md src/lib/explain/postgresPlan.ts src/lib/explain/postgresPlan.test.ts src/components/query/ExplainViewer.tsx src/components/query/ExplainViewer.test.tsx`
4. `git diff --check`
