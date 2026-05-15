# Sprint 320 Execution Brief (Slice E.2)

## Objective

DocumentDataGrid 에 `useDocumentSchemaAccumulator` wire — 누적 schema
로 header / row 를 렌더, missing field 는 NULL.

## Scope Boundary

수정/추가:
- `src/components/document/DocumentDataGrid.tsx`
- `src/components/document/DocumentDataGrid.schema.test.tsx` (NEW)
- `docs/phases/phase-28-decisions.md` (D-47..D-??)
- `docs/sprints/sprint-320/handoff.md`

미변경:
- `useDocumentSchemaAccumulator` (Sprint 319).
- 다른 컴포넌트 / hook.
- backend.

## Invariants

- 기존 DocumentDataGrid 테스트 회귀 0.

## Done Criteria

1. accumulator 호출 + merge useEffect.
2. grid columns = accumulator (with backend fallback).
3. missing field cell = NULL chip.
4. collection 변경 시 reset.
5. ≥ 5 신규 RTL.
6. tsc / lint / build / vitest exit 0.

## Verification Plan

- Profile: `command`
- Required checks: vitest run + 정적 체크 3종
- Evidence: 변경 파일 + 신규 RTL + D-47..D-??
