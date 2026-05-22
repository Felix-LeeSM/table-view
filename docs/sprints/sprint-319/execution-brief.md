# Sprint 319 Execution Brief (Slice E.1)

## Objective

`useDocumentSchemaAccumulator` 훅을 단독 구현. 페이지 간 column
변동을 흡수하는 누적 schema. `_id` first + 알파벳 정렬.

## Scope Boundary

수정/추가:
- `src/hooks/useDocumentSchemaAccumulator.ts` (NEW)
- `src/hooks/useDocumentSchemaAccumulator.test.ts` (NEW)
- `docs/phases/phase-28-decision-log.md` (D-43..D-??)
- `docs/sprints/sprint-319/handoff.md`

미변경:
- DocumentDataGrid, useDocumentGridData, documentStore.
- backend.

## Invariants

- 다른 컴포넌트/훅 회귀 0.

## Done Criteria

1. hook 초기 빈 상태.
2. `merge(columns)` union.
3. 정렬: `_id` first + 그 외 alphabetical (case-insensitive).
4. type first-wins.
5. `reset()` 및 (connId, db, coll) 변경시 auto-reset.
6. ≥ 6 unit case.
7. tsc / lint exit 0.

## Verification Plan

- Profile: `command`
- Required checks: scoped vitest + tsc + lint
- Evidence: 신규 hook + 신규 test + D-43..D-??
