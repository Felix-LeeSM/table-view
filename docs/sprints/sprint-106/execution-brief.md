# Sprint 106 Execution Brief

## Objective
DataGridTable 의 `<table>` 에 `role="grid"`, 헤더/셀에 `role="columnheader"/gridcell"` + `aria-rowindex/colindex` 부여.

## Why
스크린 리더가 데이터 그리드의 셀 위치를 인지할 수 있도록 (UI evaluation #A11Y-3).

## Scope Boundary
- `src/components/datagrid/DataGridTable.tsx` 만 변경.
- 테스트 추가.

## Invariants
- 시각 출력 동일.
- 이벤트 핸들러/edit 동작 회귀 0.

## Done Criteria
1. `<table>` `role="grid"` + `aria-rowcount` + `aria-colcount`.
2. header tr/th: `role="row"`/`role="columnheader"` + aria-rowindex/colindex.
3. body tr/td: `role="row"`/`role="gridcell"` + aria-rowindex/colindex.
4. pendingNewRows 도 동일.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`

## Evidence To Return
- 변경 라인.
- 신규 테스트 케이스.
- 1775 → ?건 통과.
- AC-01..07 매핑.
